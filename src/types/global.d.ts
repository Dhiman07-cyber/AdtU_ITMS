/// <reference types="styled-jsx" />

declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}
