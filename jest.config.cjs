/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/__tests__'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^pdfjs-dist$': '<rootDir>/src/__mocks__/pdfjs.ts',
    '^pdfjs-dist/build/pdf\\.worker\\.min\\.mjs\\?url$': '<rootDir>/src/__mocks__/pdfWorker.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  clearMocks: true,
};
