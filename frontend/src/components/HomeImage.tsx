import { useState, type ImgHTMLAttributes } from 'react';
import { Button } from '@heroui/react';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'onError'>;

function ImageAttempt({ src, alt, ...props }: Props) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (failed || !src) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted" onClick={(event) => event.stopPropagation()}>
        <span role="status">{src ? '图片加载失败' : '暂无预览'}</span>
        {src && (
          <Button size="sm" variant="secondary" aria-label={`重试加载${alt || '图片'}`} onPress={() => {
            setAttempt((value) => value + 1);
            setFailed(false);
          }}>重试</Button>
        )}
      </div>
    );
  }
  return <img {...props} key={attempt} src={src} alt={alt} decoding="async" onError={() => setFailed(true)} />;
}

export default function HomeImage(props: Props) {
  return <ImageAttempt key={props.src} {...props} />;
}
