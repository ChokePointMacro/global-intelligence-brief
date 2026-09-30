import './globals.css';

export const metadata = {
  title: 'Notes → Claude Code Agent',
  description: 'Paste notes, get a running build.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
