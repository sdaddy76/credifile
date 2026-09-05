export const GlobalWorkerOptions = { workerSrc: '' };

export function getDocument(): never {
  throw new Error('pdfjs mock: getDocument non disponibile nei test del parser');
}
