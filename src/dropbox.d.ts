interface DropboxFile {
  link: string;
  name: string;
  bytes: number;
  icon: string;
  thumbnailLink?: string;
}
interface DropboxChooserOptions {
  success: (files: DropboxFile[]) => void;
  cancel?: () => void;
  linkType?: 'preview' | 'direct';
  multiselect?: boolean;
  extensions?: string[];
}
interface Window {
  Dropbox?: { choose: (opts: DropboxChooserOptions) => void };
}
