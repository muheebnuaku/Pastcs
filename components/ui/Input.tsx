'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, type = 'text', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-800 dark:text-gray-300 mb-1">
            {label}
          </label>
        )}
        <input
          type={type}
          ref={ref}
          className={cn(
            // text-base (not the ambient text-sm many forms sit inside) —
            // an input under 16px triggers iOS Safari's zoom-on-focus.
            'w-full px-4 py-2 text-base border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0 bg-white dark:bg-white/5 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
            error
              ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-400 dark:border-white/15 focus:border-[#e8603c] focus:ring-[#e8603c]',
            className
          )}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {helperText && !error && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{helperText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };
