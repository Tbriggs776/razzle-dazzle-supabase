import React from 'react';
import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Download } from 'lucide-react';
import { SignedImage, openSignedFile, resolveFileUrl } from '@/lib/fileUrl';

export default function SalePhotosSection({ sale, lead }) {
  if (!sale || (!sale.folder_photo_url && !sale.yard_sign_photo_url && !sale.driver_license_photo_url && (!sale.product_photos || sale.product_photos.length === 0))) {
    return null;
  }

  const downloadPhoto = async (url, filename) => {
    const signedUrl = await resolveFileUrl(url);
    if (!signedUrl) return;
    const response = await fetch(signedUrl);
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(downloadUrl);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="bg-white rounded-2xl border border-border p-6 md:col-span-2"
    >
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
        Sale Documentation Photos
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sale.folder_photo_url && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">RAZZLE DAZZLE Folder</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => downloadPhoto(sale.folder_photo_url, 'folder-photo.jpg')}
                className="h-7 px-2 text-xs"
              >
                <Download className="w-3 h-3" />
              </Button>
            </div>
            <SignedImage
              src={sale.folder_photo_url}
              alt="RAZZLE DAZZLE Folder"
              className="w-full h-64 object-cover rounded-lg border border-border cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => openSignedFile(sale.folder_photo_url)}
            />
          </div>
        )}
        {sale.yard_sign_photo_url && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">Yard Sign</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => downloadPhoto(sale.yard_sign_photo_url, 'yard-sign-photo.jpg')}
                className="h-7 px-2 text-xs"
              >
                <Download className="w-3 h-3" />
              </Button>
            </div>
            <SignedImage
              src={sale.yard_sign_photo_url}
              alt="Yard Sign"
              className="w-full h-64 object-cover rounded-lg border border-border cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => openSignedFile(sale.yard_sign_photo_url)}
            />
          </div>
        )}
        {sale.driver_license_photo_url && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">Driver's License</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => downloadPhoto(sale.driver_license_photo_url, `${lead?.last_name || 'customer'}-drivers-license.jpg`)}
                className="h-7 px-2 text-xs"
              >
                <Download className="w-3 h-3" />
              </Button>
            </div>
            <SignedImage
              src={sale.driver_license_photo_url}
              alt="Driver's License"
              className="w-full h-64 object-cover rounded-lg border border-border cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => openSignedFile(sale.driver_license_photo_url)}
            />
          </div>
        )}
        {sale.yard_sign_opted_out && !sale.yard_sign_photo_url && (
          <div className="flex items-center justify-center h-64 rounded-lg border border-border bg-muted">
            <p className="text-sm text-muted-foreground">Customer opted out of yard sign</p>
          </div>
        )}
        {sale.product_photos && sale.product_photos.map((url, idx) => (
          <div key={idx}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">Final Product {idx + 1}</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => downloadPhoto(url, `product-photo-${idx + 1}.jpg`)}
                className="h-7 px-2 text-xs"
              >
                <Download className="w-3 h-3" />
              </Button>
            </div>
            <SignedImage
              src={url}
              alt={`Final Product ${idx + 1}`}
              className="w-full h-64 object-cover rounded-lg border border-border cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => openSignedFile(url)}
            />
          </div>
        ))}
      </div>
    </motion.div>
  );
}