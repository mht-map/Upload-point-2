'use client';

import { useState } from 'react';

export default function TestUploadPage() {
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [uploadedFile, setUploadedFile] = useState<any>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadStatus('Uploading...');
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      console.log('Testing upload with file:', file.name, file.type, file.size);
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      
      console.log('Response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }
      
      const result = await response.json();
      console.log('Upload result:', result);
      
      setUploadedFile(result);
      setUploadStatus('Upload successful!');
      
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleDelete = async () => {
    if (!uploadedFile?.filename) return;
    
    try {
      const response = await fetch('/api/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename: uploadedFile.filename }),
      });
      
      if (!response.ok) {
        throw new Error('Delete failed');
      }
      
      setUploadedFile(null);
      setUploadStatus('File deleted successfully!');
      
    } catch (error) {
      console.error('Delete error:', error);
      setUploadStatus(`Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Upload API Test Page</h1>
      
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Select an image file:</label>
        <input
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
      </div>
      
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Upload Status:</h2>
        <p className="text-sm text-gray-700">{uploadStatus}</p>
      </div>
      
      {uploadedFile && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded">
          <h3 className="font-semibold text-green-800 mb-2">Uploaded File:</h3>
          <div className="text-sm text-green-700 space-y-1">
            <p><strong>Original Name:</strong> {uploadedFile.originalName}</p>
            <p><strong>Server Filename:</strong> {uploadedFile.filename}</p>
            <p><strong>URL:</strong> {uploadedFile.url}</p>
            <p><strong>Size:</strong> {uploadedFile.size} bytes</p>
            <p><strong>Type:</strong> {uploadedFile.type}</p>
          </div>
          
          {uploadedFile.url && (
            <div className="mt-4">
              <h4 className="font-semibold text-green-800 mb-2">Image Preview:</h4>
              <img 
                src={uploadedFile.url} 
                alt="Uploaded image" 
                className="max-w-full h-auto border border-green-300 rounded"
                style={{ maxHeight: '300px' }}
              />
            </div>
          )}
          
          <button
            onClick={handleDelete}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Delete File
          </button>
        </div>
      )}
      
      <div className="text-sm text-gray-600">
        <h3 className="font-semibold mb-2">Test Instructions:</h3>
        <ol className="list-decimal list-inside space-y-1">
          <li>Select an image file (PNG, JPG, WebP)</li>
          <li>Check the console for detailed logs</li>
          <li>Verify the file appears in public/uploads/</li>
          <li>Test the delete functionality</li>
        </ol>
      </div>
    </div>
  );
}
