import type { Metadata } from 'next';
import './globals.css';
import { productName } from '@/lib/config';
export const metadata: Metadata = {
  title: productName,
  description: 'Your F-1 document organizer, date tracker and WhatsApp assistant.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
