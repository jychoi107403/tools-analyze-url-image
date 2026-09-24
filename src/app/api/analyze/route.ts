import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import sharp from 'sharp';

// To ignore TLS errors if fetching images from a bad cert site, optional but helpful for a tool like this.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export async function POST(req: Request) {
  try {
    const { url } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    let targetUrl = url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    // 1. Fetch the HTML content
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Failed to fetch URL: ${response.statusText}` }, { status: response.status });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 2. Extract image URLs
    const imageUrls = new Set<string>();

    $('img').each((i, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src');
      if (src) {
        // Handle relative URLs
        try {
          const absoluteUrl = new URL(src, targetUrl).href;
          imageUrls.add(absoluteUrl);
        } catch (e) {
          // ignore invalid URLs
        }
      }
    });

    // Also look for background images in inline styles (basic check)
    $('[style*="background-image"]').each((i, el) => {
      const style = $(el).attr('style');
      if (style) {
        const match = style.match(/url\(['"]?(.*?)['"]?\)/);
        if (match && match[1]) {
          try {
            const absoluteUrl = new URL(match[1], targetUrl).href;
            imageUrls.add(absoluteUrl);
          } catch (e) {
            // ignore invalid
          }
        }
      }
    });

    const uniqueImages = Array.from(imageUrls);

    // 3. Process each image (fetch, measure, compress)
    const results = [];

    // Process in batches or concurrently (up to 10 at a time to avoid timeout/OOM)
    const MAX_CONCURRENT = 10;
    for (let i = 0; i < uniqueImages.length; i += MAX_CONCURRENT) {
      const batch = uniqueImages.slice(i, i + MAX_CONCURRENT);
      
      const batchResults = await Promise.all(
        batch.map(async (imgUrl) => {
          try {
            // Fetch image data
            const imgRes = await fetch(imgUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0',
                'Referer': targetUrl,
              },
            });
            
            if (!imgRes.ok) return null;

            const arrayBuffer = await imgRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            const originalSize = buffer.byteLength;
            if (originalSize === 0) return null;

            // Optional: skip very small images (e.g., tracking pixels < 1KB)
            if (originalSize < 1024) return null;

            // 4. Compress with Sharp to WebP
            let compressedBuffer;
            try {
              compressedBuffer = await sharp(buffer)
                .webp({ quality: 75 })
                .toBuffer();
            } catch (err) {
              // If sharp fails (e.g., unsupported format like svg), fallback to original size
              return {
                url: imgUrl,
                originalSize,
                compressedSize: originalSize,
                savings: 0,
                savingsPercent: 0,
                format: 'unsupported'
              };
            }

            const compressedSize = compressedBuffer.byteLength;
            
            // Only report savings if it actually saved space
            const finalSize = Math.min(originalSize, compressedSize);
            const savings = originalSize - finalSize;
            const savingsPercent = originalSize > 0 ? (savings / originalSize) * 100 : 0;

            return {
              url: imgUrl,
              originalSize,
              compressedSize: finalSize,
              savings,
              savingsPercent: parseFloat(savingsPercent.toFixed(2)),
              format: 'webp'
            };
          } catch (error) {
            return null; // Skip images that fail to fetch or process
          }
        })
      );

      // Filter out nulls and add to results
      results.push(...batchResults.filter(Boolean));
    }

    return NextResponse.json({
      success: true,
      url: targetUrl,
      totalImagesFound: uniqueImages.length,
      processedImages: results.length,
      images: results,
    });
  } catch (error: any) {
    console.error('Analyze Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
