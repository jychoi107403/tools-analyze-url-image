import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

// Cloudflare Edge 환경에서 실행되도록 명시합니다. (필수)
export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { url } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'URL을 입력해주세요.' }, { status: 400 });
    }

    // 입력받은 URL에 http 프로토콜이 없으면 자동으로 붙여줍니다.
    let targetUrl = url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    // 1. 타겟 웹페이지 HTML 가져오기
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: `URL 연결 실패: ${response.statusText}` }, { status: response.status });
    }

    const html = await response.text();
    // cheerio를 사용해 HTML 문서를 파싱(해석)합니다.
    const $ = cheerio.load(html);

    // 2. 이미지 URL 추출하기 (중복 방지를 위해 Set 사용)
    const imageUrls = new Set<string>();

    // <img> 태그에서 src 또는 data-src(지연 로딩) 속성을 찾습니다.
    $('img').each((i, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src');
      if (src) {
        try {
          // 상대 경로를 절대 경로로 변환합니다.
          const absoluteUrl = new URL(src, targetUrl).href;
          imageUrls.add(absoluteUrl);
        } catch (e) {
          // 유효하지 않은 URL은 무시합니다.
        }
      }
    });

    // 배경 이미지 스타일(background-image)에서도 URL을 추출합니다.
    $('[style*="background-image"]').each((i, el) => {
      const style = $(el).attr('style');
      if (style) {
        const match = style.match(/url\(['"]?(.*?)['"]?\)/);
        if (match && match[1]) {
          try {
            const absoluteUrl = new URL(match[1], targetUrl).href;
            imageUrls.add(absoluteUrl);
          } catch (e) {
            // 유효하지 않은 URL은 무시합니다.
          }
        }
      }
    });

    const uniqueImages = Array.from(imageUrls);

    // 3. 각 이미지 원본 용량 파악 및 압축 예측 계산
    const results = [];

    // Cloudflare Edge 제한을 고려하여 10개씩 묶어서 병렬 처리합니다.
    const MAX_CONCURRENT = 10;
    for (let i = 0; i < uniqueImages.length; i += MAX_CONCURRENT) {
      const batch = uniqueImages.slice(i, i + MAX_CONCURRENT);
      
      const batchResults = await Promise.all(
        batch.map(async (imgUrl) => {
          try {
            // 이미지 전체를 다운로드하지 않고, 헤더(HEAD)만 요청해서 용량(Content-Length)을 빠르게 알아냅니다.
            const imgRes = await fetch(imgUrl, {
              method: 'HEAD',
              headers: {
                'User-Agent': 'Mozilla/5.0',
                'Referer': targetUrl,
              },
            });
            
            if (!imgRes.ok) return null;

            const contentLength = imgRes.headers.get('content-length');
            let originalSize = 0;
            
            if (contentLength) {
                // Content-Length가 제공되는 경우 즉시 파악
                originalSize = parseInt(contentLength, 10);
            } else {
                // HEAD 요청으로 용량을 모를 경우에만 GET으로 본문을 받아 용량을 측정합니다.
                const getRes = await fetch(imgUrl);
                const arrayBuffer = await getRes.arrayBuffer();
                originalSize = arrayBuffer.byteLength;
            }

            // 용량이 0이거나 1KB보다 작은 이미지는 무시합니다 (아이콘 등).
            if (originalSize === 0) return null;
            if (originalSize < 1024) return null;

            // 4. WebP 변환 시 예측 용량 계산
            // 기존 sharp 라이브러리 대신, 일반적으로 원본의 60% 수준으로 압축된다고 가정한 "예측치"를 계산합니다.
            const estimatedCompressedSize = Math.floor(originalSize * 0.6); 
            
            const savings = originalSize - estimatedCompressedSize;
            const savingsPercent = (savings / originalSize) * 100;

            return {
              url: imgUrl,
              originalSize,
              compressedSize: estimatedCompressedSize,
              savings,
              savingsPercent: parseFloat(savingsPercent.toFixed(2)),
              format: 'webp (예측치)'
            };
          } catch (error) {
            return null; // 처리에 실패한 이미지는 건너뜁니다.
          }
        })
      );

      results.push(...batchResults.filter(Boolean));
    }

    // 최종 분석 결과를 반환합니다.
    return NextResponse.json({
      success: true,
      url: targetUrl,
      totalImagesFound: uniqueImages.length,
      processedImages: results.length,
      images: results,
    });
  } catch (error: any) {
    console.error('Analyze Error:', error);
    return NextResponse.json({ error: error.message || '서버 내부 오류가 발생했습니다.' }, { status: 500 });
  }
}
