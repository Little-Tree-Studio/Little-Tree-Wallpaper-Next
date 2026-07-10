import { Avatar } from '@heroui/react';
import { Image as ImageIcon } from 'lucide-react';

interface SourceIconProps {
  src?: string | null;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses: Record<Required<SourceIconProps>['size'], string> = {
  xs: 'h-4 w-4 text-[8px]',
  sm: 'h-5 w-5 text-[10px]',
  md: 'h-6 w-6 text-xs',
  lg: 'h-8 w-8 text-sm',
};

function getInitials(name?: string): string {
  if (!name) return '';
  const chars = name.trim().split(/\s+/).map((s) => s[0]).filter(Boolean);
  return chars.slice(0, 2).join('').toUpperCase() || name.trim()[0]?.toUpperCase() || '';
}

export default function SourceIcon({ src, name, size = 'md', className = '' }: SourceIconProps) {
  const initials = getInitials(name);
  const hasSrc = Boolean(src && src.trim());

  return (
    <Avatar className={`shrink-0 ${sizeClasses[size]} ${className}`}>
      {hasSrc ? <Avatar.Image alt={name || ''} src={src!} /> : null}
      <Avatar.Fallback>
        {initials || <ImageIcon className="h-[55%] w-[55%]" />}
      </Avatar.Fallback>
    </Avatar>
  );
}
