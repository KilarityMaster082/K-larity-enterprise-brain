// Owner task: EB-91 UI design system — static image imports are resolved by the Next.js bundler.
declare module "*.png" {
  const img: { src: string; width: number; height: number; blurDataURL?: string };
  export default img;
}
