// Owner task: EB-90 Brand guide — the K!larity logo. The wordmark is ink on light surfaces and white on dark;
// the asterisk mark and the "!" stay brand orange in both. Files are extracted from brand/logo-original.png.
// Apps wrap it in their own router link.
import logoDark from "../../brand/logo-on-dark.png";
import logoLight from "../../brand/logo.png";
import mark from "../../brand/mark.png";

export function Logo({ width = 132, caption }: { width?: number; caption?: string }) {
  const height = Math.round((width * logoLight.height) / logoLight.width);
  return (
    <span className="logo-block">
      <span className="logo">
        <img className="logo-light" src={logoLight.src} width={width} height={height} alt="K!larity" />
        <img className="logo-dark" src={logoDark.src} width={width} height={height} alt="" aria-hidden="true" />
      </span>
      {caption ? <span className="logo-caption">{caption}</span> : null}
    </span>
  );
}

export function LogoMark({ size = 28, label }: { size?: number; label?: string }) {
  return (
    <img
      src={mark.src}
      width={size}
      height={Math.round((size * mark.height) / mark.width)}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
    />
  );
}
