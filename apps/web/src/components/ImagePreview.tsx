import { useEffect, useRef } from 'react';
import type { PreviewImage } from '@zhian/shared';

function Canvas({ pixels, width, height, label }: { pixels: number[] | null; width: number; height: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    if (!pixels) {
      ctx.fillStyle = '#0a131b';
      ctx.fillRect(0, 0, width, height);
      return;
    }
    const data = ctx.createImageData(width, height);
    pixels.forEach((value, index) => {
      data.data[index * 4] = value;
      data.data[index * 4 + 1] = value;
      data.data[index * 4 + 2] = value;
      data.data[index * 4 + 3] = 255;
    });
    ctx.putImageData(data, 0, 0);
  }, [pixels, width, height]);
  return (
    <figure className="image-cell">
      <canvas ref={ref} width={width} height={height} aria-label={label} />
      <figcaption>{pixels ? label : `${label}（已删除）`}</figcaption>
    </figure>
  );
}

/** 工位摄像头图像：处理前后对比（程序合成图，非真实人像） */
export function ImagePreview({ image }: { image: PreviewImage }) {
  return (
    <div className="image-preview">
      <Canvas pixels={image.original} width={image.width} height={image.height} label="原始图像" />
      <Canvas pixels={image.processed} width={image.width} height={image.height} label="处理后" />
    </div>
  );
}
