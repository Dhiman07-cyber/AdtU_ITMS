"use client";

import { safeImageSrc } from '@/lib/security/url-sanitizer';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface AvatarProps {
  src?: string | null;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeClasses = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg'
};

const colorPalette = [
  'bg-blue-600',
  'bg-purple-600',
  'bg-green-600',
  'bg-orange-600',
  'bg-pink-600',
  'bg-indigo-600',
  'bg-teal-600',
  'bg-red-600'
];

function getInitials(name: string): string {
  if (!name) return '?';
  
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getColorFromName(name: string): string {
  // Generate consistent color based on name
  if (!name) return colorPalette[0];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colorPalette.length;
  return colorPalette[index];
}

export default function Avatar({ src, name = '', size = 'md', className }: AvatarProps) {
  const [imageError, setImageError] = useState(false);
  const initials = getInitials(name || '');
  const bgColor = getColorFromName(name || '');
  
  const shouldShowImage = src && !imageError;

  return (
    <div 
      className={cn(
        "rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden",
        sizeClasses[size],
        !shouldShowImage && `${bgColor} text-white`,
        className
      )}
      title={name}
    >
      {shouldShowImage ? (
        <img
          src={safeImageSrc(src)}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setImageError(true)}
          loading="lazy"
        />
      ) : (
        <span className="font-semibold select-none">{initials}</span>
      )}
    </div>
  );
}


