import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calculator, Package, ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';

export default function Calculators() {
  const [roomSize, setRoomSize] = useState('');
  const [result, setResult] = useState(null);

  const COVERAGE_PER_GALLON = 170; // sq ft per gallon

  const calculateGlue = () => {
    const sqFt = parseFloat(roomSize);
    if (!sqFt || sqFt <= 0) {
      setResult(null);
      return;
    }

    const totalGallonsNeeded = sqFt / COVERAGE_PER_GALLON;
    
    // Calculate optimal mix: prioritize 4-gallon containers
    const fourGallonContainers = Math.floor(totalGallonsNeeded / 4);
    const remainingGallons = totalGallonsNeeded - (fourGallonContainers * 4);
    const oneGallonContainers = Math.ceil(remainingGallons);

    const totalGallons = (fourGallonContainers * 4) + oneGallonContainers;
    const actualCoverage = totalGallons * COVERAGE_PER_GALLON;

    setResult({
      fourGallon: fourGallonContainers,
      oneGallon: oneGallonContainers,
      totalGallons,
      actualCoverage,
      excess: actualCoverage - sqFt
    });
  };

  const handleReset = () => {
    setRoomSize('');
    setResult(null);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link
            to={createPageUrl('OrderProcessing')}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Order Processing
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
              <Calculator className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Calculators</h1>
              <p className="text-muted-foreground mt-1">Tools for material and cost calculations</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-primary" />
                Glue Usage Calculator
              </CardTitle>
              <CardDescription>
                Calculate the optimal mix of 4-gallon and 1-gallon glue containers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Coverage Info */}
              <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                <p className="text-sm text-foreground">
                  <strong>Coverage:</strong> {COVERAGE_PER_GALLON} sq ft per gallon
                </p>
              </div>

              {/* Input */}
              <div className="space-y-2">
                <Label htmlFor="roomSize">Room Size (sq ft)</Label>
                <Input
                  id="roomSize"
                  type="number"
                  placeholder="Enter room size in square feet"
                  value={roomSize}
                  onChange={(e) => setRoomSize(e.target.value)}
                  className="text-lg h-12"
                />
              </div>

              {/* Calculate Button */}
              <div className="flex gap-3">
                <Button
                  onClick={calculateGlue}
                  disabled={!roomSize || parseFloat(roomSize) <= 0}
                  className="flex-1 bg-primary text-primary-foreground hover:opacity-90 h-12"
                >
                  <Calculator className="w-4 h-4 mr-2" />
                  Calculate
                </Button>
                {result && (
                  <Button
                    onClick={handleReset}
                    variant="outline"
                    className="h-12 px-6"
                  >
                    Reset
                  </Button>
                )}
              </div>

              {/* Results */}
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4 pt-4 border-t border-border"
                >
                  <h3 className="font-semibold text-foreground text-lg">Order Recommendation</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 4-Gallon Containers */}
                    <div className="p-6 rounded-xl bg-primary/10 border border-primary/20">
                      <div className="flex items-center gap-3 mb-2">
                        <Package className="w-6 h-6 text-primary" />
                        <p className="text-sm font-medium text-primary">4-Gallon Containers</p>
                      </div>
                      <p className="text-4xl font-bold text-foreground">{result.fourGallon}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {result.fourGallon * 4} gallons total
                      </p>
                    </div>

                    {/* 1-Gallon Containers */}
                    <div className="p-6 rounded-xl bg-brand-blue/10 border border-brand-blue/20">
                      <div className="flex items-center gap-3 mb-2">
                        <Package className="w-6 h-6 text-brand-blue" />
                        <p className="text-sm font-medium text-brand-blue">1-Gallon Containers</p>
                      </div>
                      <p className="text-4xl font-bold text-foreground">{result.oneGallon}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {result.oneGallon} {result.oneGallon === 1 ? 'gallon' : 'gallons'} total
                      </p>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="p-4 rounded-lg bg-secondary space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Gallons:</span>
                      <span className="font-semibold text-foreground">{result.totalGallons.toFixed(2)} gal</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Coverage:</span>
                      <span className="font-semibold text-foreground">{result.actualCoverage.toFixed(0)} sq ft</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Excess Coverage:</span>
                      <span className="font-semibold text-green-600 dark:text-green-400">+{result.excess.toFixed(0)} sq ft</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}