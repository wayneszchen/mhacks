import React from 'react';
import classNames from 'classnames';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
};

export default function Button({ className, variant = 'primary', ...props }: Props) {
  const base = 'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-transparent';
  const styles = {
    primary: 'bg-brand-600 hover:bg-brand-500 text-white focus:ring-brand-600',
    secondary: 'bg-white/10 hover:bg-white/20 text-white focus:ring-white/30',
    ghost: 'hover:bg-white/10 text-white focus:ring-white/20'
  };
  return <button className={classNames(base, styles[variant], className)} {...props} />;
}
