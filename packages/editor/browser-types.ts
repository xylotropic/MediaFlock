// Standard File System API iterable methods are implemented by supported
// Chrome/Electron hosts but absent from TypeScript 5.9's DOM declarations.
declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
}
export {};
