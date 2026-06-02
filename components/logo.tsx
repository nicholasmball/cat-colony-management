import Image from "next/image";

// Street Cats of Tavira wordmark (black artwork; inverts on dark backgrounds).
export function Logo({
  className,
  width = 132,
}: {
  className?: string;
  width?: number;
}) {
  const height = Math.round((width * 339) / 499);
  return (
    <Image
      src="/scot-logo.png"
      alt="Street Cats of Tavira"
      width={width}
      height={height}
      priority
      className={`h-auto dark:invert ${className ?? ""}`}
    />
  );
}
