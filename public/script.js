const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

document.getElementById('analyze-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const urlInput = document.getElementById('url-input').value;
  if (!urlInput) return;

  const btn = document.getElementById('analyze-btn');
  const loader = document.getElementById('loader');
  const resultsContainer = document.getElementById('results-container');
  const errorContainer = document.getElementById('error-message');
  
  btn.disabled = true;
  btn.innerText = '분석 중...';
  loader.style.display = 'flex';
  resultsContainer.style.display = 'none';
  errorContainer.style.display = 'none';

  try {
    // 1. Fetch HTML via Proxy
    const proxyUrl = `/proxy?url=${encodeURIComponent(urlInput)}`;
    const htmlResponse = await fetch(proxyUrl);
    
    if (!htmlResponse.ok) throw new Error('페이지를 불러올 수 없습니다. URL을 확인해주세요.');
    
    const htmlText = await htmlResponse.text();
    
    // 2. Parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    
    const imageUrls = new Set();
    const baseUri = urlInput.startsWith('http') ? urlInput : 'https://' + urlInput;
    
    const extractImagesFromDoc = (currentDoc, baseUrl) => {
      currentDoc.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
        if (src && !src.startsWith('data:')) {
          try { imageUrls.add(new URL(src, baseUrl).href); } catch(e){}
        }
      });
      
      currentDoc.querySelectorAll('[style*="background-image"]').forEach(el => {
        const bg = el.style.backgroundImage;
        if (bg && bg !== 'none') {
          const match = bg.match(/url\(['"]?(.*?)['"]?\)/);
          if (match && match[1] && !match[1].startsWith('data:')) {
             try { imageUrls.add(new URL(match[1], baseUrl).href); } catch(e){}
          }
        }
      });
    };
    
    extractImagesFromDoc(doc, baseUri);

    const iframes = doc.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.getAttribute('src');
      if (src) {
        try {
          const iframeUrl = new URL(src, baseUri).href;
          const iframeProxyUrl = `/proxy?url=${encodeURIComponent(iframeUrl)}`;
          const iframeRes = await fetch(iframeProxyUrl);
          if (iframeRes.ok) {
             const iframeText = await iframeRes.text();
             const iframeDoc = parser.parseFromString(iframeText, 'text/html');
             extractImagesFromDoc(iframeDoc, iframeUrl);
          }
        } catch(e) {}
      }
    }

    // 3. Process Images using Canvas for WebP Compression Simulation
    const uniqueImages = Array.from(imageUrls);
    const results = [];
    
    for (const imgUrl of uniqueImages) {
      try {
        // Fetch image via proxy to avoid CORS and get original size
        const imgProxy = `/proxy?url=${encodeURIComponent(imgUrl)}`;
        const imgRes = await fetch(imgProxy);
        if (!imgRes.ok) continue;
        
        const blob = await imgRes.blob();
        const originalSize = blob.size;
        
        if (originalSize < 1024) continue; // Skip tiny images

        // Compress using Canvas
        const compressedSize = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            // Export as WebP
            const dataUrl = canvas.toDataURL('image/webp', 0.8);
            
            // Calculate approximate byte size of base64 string
            // formula: (length * 3/4) - padding
            const base64Length = dataUrl.split(',')[1].length;
            const padding = (dataUrl.match(/=/g) || []).length;
            const approxSize = Math.floor((base64Length * 3) / 4 - padding);
            
            resolve(approxSize);
          };
          img.onerror = () => resolve(originalSize); // Fallback to original if error
          img.src = URL.createObjectURL(blob);
        });

        const finalSize = Math.min(originalSize, compressedSize);
        const savings = originalSize - finalSize;
        const savingsPercent = originalSize > 0 ? (savings / originalSize) * 100 : 0;

        results.push({
          url: imgUrl,
          proxyUrl: imgProxy,
          originalSize,
          compressedSize: finalSize,
          savings,
          savingsPercent: parseFloat(savingsPercent.toFixed(2))
        });
      } catch (err) {
        console.warn('Skipping image', imgUrl, err);
      }
    }

    // 4. Update UI
    results.sort((a,b) => b.savings - a.savings);
    
    const totalOriginal = results.reduce((sum, img) => sum + img.originalSize, 0);
    const totalCompressed = results.reduce((sum, img) => sum + img.compressedSize, 0);
    const totalSavings = totalOriginal - totalCompressed;
    const totalSavingsPercent = totalOriginal > 0 ? (totalSavings / totalOriginal) * 100 : 0;

    document.getElementById('total-images').innerText = `${results.length}개`;
    document.getElementById('total-original').innerText = formatBytes(totalOriginal);
    document.getElementById('total-savings').innerText = formatBytes(totalSavings);
    document.getElementById('total-percent').innerText = `${totalSavingsPercent.toFixed(1)}%`;

    const grid = document.getElementById('image-grid');
    grid.innerHTML = '';
    
    if (results.length === 0) {
      grid.innerHTML = `<div class="glass" style="padding: 2rem; text-align: center; grid-column: 1/-1;">분석할 수 있는 적절한 크기의 이미지를 찾지 못했습니다.</div>`;
    } else {
      results.forEach(img => {
        grid.innerHTML += `
          <div class="image-card glass">
            <div class="img-preview-container">
              <img src="${img.proxyUrl}" alt="Analyzed" class="img-preview" loading="lazy" />
            </div>
            <div class="card-details">
              <div class="url-text" title="${img.url}">${img.url}</div>
              
              <div class="stats-row">
                <span>원본 크기</span>
                <span>${formatBytes(img.originalSize)}</span>
              </div>
              <div class="stats-row">
                <span>압축 후 (WebP)</span>
                <span>${formatBytes(img.compressedSize)}</span>
              </div>
              
              ${img.savingsPercent > 0 ? `
                <div class="savings-badge">
                  ${img.savingsPercent}% (${formatBytes(img.savings)}) 절약!
                </div>
              ` : `
                <div class="savings-badge" style="background: rgba(148, 163, 184, 0.2); color: #94a3b8;">
                  최적화 됨
                </div>
              `}
            </div>
          </div>
        `;
      });
    }

    resultsContainer.style.display = 'block';
  } catch (err) {
    errorContainer.innerText = err.message;
    errorContainer.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerText = '분석 시작';
    loader.style.display = 'none';
  }
});
