import clsx from "clsx";
import { ReactNode } from "react";

interface CardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function Card({
  title,
  description,
  children,
  className,
}: CardProps) {
  return (
    <div
      className={clsx(
        "bg-gray-800 border border-gray-700 rounded-xl p-6",
        className
      )}
    >
      {title && (
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      )}
      {description && (
        <p className="mt-1 text-sm text-gray-400">{description}</p>
      )}
      {(title || description) && <div className="mt-4">{children}</div>}
      {!title && !description && children}
    </div>
  );
}
