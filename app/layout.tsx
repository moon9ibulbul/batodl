import '../styles/globals.css';
import React from 'react';

export const metadata = {
  title: 'Batoto Stitcher',
  description: 'Download & stitch Batoto chapters on the web',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}