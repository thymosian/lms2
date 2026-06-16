'use client';
import React from 'react';
import FileUpload from '@/components/ui/FileUpload';

export default function VerifyFileUpload() {
  return (
    <div style={{ padding: '50px' }}>
      <h1>File Upload Verification</h1>
      <FileUpload onFilesSelected={(files) => console.log('Files selected:', files)} />
    </div>
  );
}
