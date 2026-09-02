import React, { useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Camera, X, RotateCw, Check } from 'lucide-react';

export function CameraCapture({ onCapture, label }) {
  const [showCamera, setShowCamera] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const webcamRef = useRef(null);

  const capture = () => {
    const imageSrc = webcamRef.current.getScreenshot();
    setCapturedImage(imageSrc);
  };

  const retake = () => {
    setCapturedImage(null);
  };

  const confirm = () => {
    onCapture(capturedImage);
    setShowCamera(false);
    setCapturedImage(null);
  };

  const toggleCamera = () => {
    setCapturedImage(null);
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  return (
    <>
      <Button
        type="button"
        onClick={() => setShowCamera(true)}
        variant="outline"
        className="w-full h-20 border-dashed"
      >
        <Camera className="w-5 h-5 mr-2" />
        {label}
      </Button>

      <Dialog open={showCamera} onOpenChange={setShowCamera}>
        <DialogContent className="max-w-2xl p-0">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle>Take Photo</DialogTitle>
          </DialogHeader>
          
          <div className="relative">
            {!capturedImage ? (
              <div className="relative bg-black">
                <Webcam
                  key={facingMode}
                  ref={webcamRef}
                  audio={false}
                  screenshotFormat="image/jpeg"
                  videoConstraints={{
                    facingMode: facingMode
                  }}
                  className="w-full"
                />
                <Button
                  onClick={toggleCamera}
                  variant="outline"
                  size="icon"
                  className="absolute top-4 right-4 bg-white/90"
                >
                  <RotateCw className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <img src={capturedImage} alt="Captured" className="w-full" />
            )}
          </div>

          <DialogFooter className="p-6 pt-0">
            {!capturedImage ? (
              <>
                <Button variant="outline" onClick={() => setShowCamera(false)}>
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button onClick={capture} className="bg-info hover:bg-info">
                  <Camera className="w-4 h-4 mr-2" />
                  Capture
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={retake}>
                  <RotateCw className="w-4 h-4 mr-2" />
                  Retake
                </Button>
                <Button onClick={confirm} className="bg-good hover:bg-good">
                  <Check className="w-4 h-4 mr-2" />
                  Use Photo
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}