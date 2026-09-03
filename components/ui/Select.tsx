'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options?: { value: string; label: string }[];
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, children, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-800 dark:text-gray-300 mb-1">
            {label}
          </label>
        )}
        <select
          ref={ref}
          className={cn(
            // text-base — see Input.tsx for why (iOS zoom-on-focus under 16px)
            'w-full px-4 py-2 text-base border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0 bg-white dark:bg-white/5 text-gray-900 dark:text-gray-100',
            error
              ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-400 dark:border-white/15 focus:border-[#e8603c] focus:ring-[#e8603c]',
            className
          )}
          {...props}
        >
          {options
            ? options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            : children}
        </select>
        {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';

export { Select };
