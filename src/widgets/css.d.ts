// Allow importing global stylesheets (Ring UI) from the widget entry points; the
// esbuild build handles the actual bundling. Declared here so `tsc` accepts the import.
declare module '*.css';
