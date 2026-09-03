(() => {
  if (window.__cdim_initialized__) return;
  window.__cdim_initialized__ = true;
  window.__cdim_open__ = false;

  // CSS
  const style = document.createElement('style');
  style.textContent = `
#cdim-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);overscroll-behavior:contain;user-select:none}
#cdim-viewer{position:relative;overflow:hidden;touch-action:none;cursor:grab;box-sizing:border-box;border-radius:12px;background:rgba(0,0,0,.15)}
#cdim-topbar{position:absolute;left:0;right:0;top:0;height:40px;box-sizing:border-box;padding:8px 12px;background:linear-gradient(to bottom, rgba(0,0,0,.45), rgba(0,0,0,0));color:#fff;font:14px/24px system-ui;pointer-events:none}
#cdim-img{display:block;position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;user-select:none;pointer-events:none}
`;
  document.documentElement.appendChild(style);

  // Scroll lock helpers
  const lockScroll = () => {
    document.documentElement.dataset.cdimLock = '1';
    const bar = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.overflow = 'hidden';
    if (bar > 0) document.documentElement.style.paddingRight = bar + 'px';
  };
  const unlockScroll = () => {
    delete document.documentElement.dataset.cdimLock;
    document.documentElement.style.overflow = '';
    document.documentElement.style.paddingRight = '';
  };

  function createOverlay(src, naturalWidth, naturalHeight) {
    const overlay = document.createElement('div');
    overlay.id = 'cdim-overlay';

    const viewer = document.createElement('div');
    viewer.id = 'cdim-viewer';

    const img = document.createElement('img');
    img.id = 'cdim-img';
    img.src = src;
    img.alt = '';

    const topbar = document.createElement('div');
    topbar.id = 'cdim-topbar';

    viewer.appendChild(img);
    viewer.appendChild(topbar);
    overlay.appendChild(viewer);
    document.documentElement.appendChild(overlay);
    window.__cdim_open__ = true;
    lockScroll();

    // state
    let scale = 1, fitScale = 1;
    const margin = 24;
    let tx = 0, ty = 0;

    // set intrinsic for transform math
    img.style.width = `${naturalWidth}px`;
    img.style.height = `${naturalHeight}px`;

    // Clamp pan so image doesn't get lost
    const clampPan = () => {
      const r = viewer.getBoundingClientRect();
      const imgW = naturalWidth * scale;
      const imgH = naturalHeight * scale;

      const minX = imgW < r.width  ? Math.round((r.width  - imgW)/2) : r.width  - imgW;
      const maxX = imgW < r.width  ? minX : 0;
      const minY = imgH < r.height ? Math.round((r.height - imgH)/2) : r.height - imgH;
      const maxY = imgH < r.height ? minY : 0;

      if (tx < minX) tx = minX;
      if (tx > maxX) tx = maxX;
      if (ty < minY) ty = minY;
      if (ty > maxY) ty = maxY;
    };

    const updateTransform = () => {
      clampPan();
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };

    // Fit & center (account for topbar in viewer height)
    const centerImage = () => {
      const th = topbar.getBoundingClientRect().height || 40;

      const availW = Math.min(window.innerWidth  - margin*2, 12000);
      const availH = Math.min(window.innerHeight - margin*2, 12000);

      fitScale = Math.min(
        availW / naturalWidth,
        (availH - th) / naturalHeight
      );
      scale = fitScale;

      const imgWf = Math.min(availW, naturalWidth * scale);
      const imgHf = Math.min(availH - th, naturalHeight * scale);

      // viewer must hold topbar + image
      viewer.style.width  = `${imgWf}px`;
      viewer.style.height = `${imgHf + th}px`;

      // center image under the topbar
      tx = Math.round((imgWf - naturalWidth * scale) / 2);
      ty = th + Math.round((imgHf - naturalHeight * scale) / 2);

      updateTransform();
    };
    centerImage();

    const onResize = () => {
      const prevScale = scale;
      const prevTx = tx, prevTy = ty;
      centerImage();                   // updates fitScale
      scale = Math.max(prevScale, fitScale);
      tx = prevTx; ty = prevTy;
      updateTransform();
    };
    window.addEventListener('resize', onResize);

    // pointer/mouse pan
    let dragging = false, lx = 0, ly = 0;
    const onDown = (e) => {
      dragging = true;
      viewer.style.cursor = 'grabbing';
      if (viewer.setPointerCapture && e.pointerId !== undefined) {
        try { viewer.setPointerCapture(e.pointerId); } catch {}
      }
      lx = e.clientX; ly = e.clientY;
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      tx += dx; ty += dy;
      updateTransform();
    };
    const onUp = (e) => {
      dragging = false;
      viewer.style.cursor = 'grab';
      if (viewer.releasePointerCapture && e?.pointerId !== undefined) {
        try { viewer.releasePointerCapture(e.pointerId); } catch {}
      }
    };

    viewer.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // touch pan (single finger)
    let touchId = null;
    viewer.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      touchId = t.identifier;
      dragging = true;
      lx = t.clientX; ly = t.clientY;
    }, { passive: true });

    viewer.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const t = Array.from(e.touches).find(x => x.identifier === touchId);
      if (!t) return;
      const dx = t.clientX - lx;
      const dy = t.clientY - ly;
      lx = t.clientX; ly = t.clientY;
      tx += dx; ty += dy;
      updateTransform();
    }, { passive: true });

    const endTouch = () => { dragging = false; };
    viewer.addEventListener('touchend', endTouch, { passive: true });
    viewer.addEventListener('touchcancel', endTouch, { passive: true });

    // wheel zoom (normalized)
    const normDeltaY = (e) => {
      if (e.deltaMode === 1) return e.deltaY * 16;
      if (e.deltaMode === 2) return e.deltaY * window.innerHeight;
      return e.deltaY;
    };
    viewer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dy = normDeltaY(e);
      const step = 0.12 * (dy > 0 ? -1 : 1);

      const oldScale = scale;
      scale = Math.min(10, Math.max(fitScale, scale + step));

      const rect = viewer.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const ox = (cx - tx) / oldScale;
      const oy = (cy - ty) / oldScale;
      tx = cx - ox * scale;
      ty = cy - oy * scale;

      updateTransform();
    }, { passive: false });

    // close
    const onKey = (e)=>{ if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);

    const close = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      overlay.remove();
      unlockScroll();
      window.__cdim_open__ = false;
    };

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.addEventListener('dblclick', e => e.stopPropagation(), true);

    return overlay;
  }

  function handleDblClick(e) {
    if (window.__cdim_open__) return;
    const imgEl = e.target.closest('img');
    if (!imgEl || !imgEl.src) return;

    const src = imgEl.currentSrc || imgEl.src;

    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => createOverlay(src, probe.naturalWidth, probe.naturalHeight);
    probe.onerror = () => {
      const w = imgEl.naturalWidth || imgEl.width;
      const h = imgEl.naturalHeight || imgEl.height;
      createOverlay(src, w, h);
    };
    probe.src = src;
  }

  if (!window.__cdim_dbl__) {
    document.addEventListener('dblclick', handleDblClick, true);
    window.__cdim_dbl__ = true;
  }
})();
