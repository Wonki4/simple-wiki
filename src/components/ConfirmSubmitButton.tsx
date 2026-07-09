"use client";

export function ConfirmSubmitButton({ message, children, className }: {
  message: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
