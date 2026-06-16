import React from 'react';
import { createRoot } from 'react-dom/client';
import FileUpload from '/app/src/components/ui/FileUpload';

const root = createRoot(document.getElementById('root')!);
root.render(
  <div style={{ padding: '50px' }}>
    <h1>File Upload Accessibility Test</h1>
    <FileUpload onFilesSelected={(files) => console.log('Selected:', files)} />
  </div>
);
