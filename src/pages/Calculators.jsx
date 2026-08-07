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
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <Link
            to={createPageUrl('OrderProcessing')}
            className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Order Processing
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Calculator className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Calculators</h1>
              <p className="text-slate-500 mt-1">Tools for material and cost calculations</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-indigo-600" />
                Glue Usage Calculator
              </CardTitle>
              <CardDescription>
                Calculate the optimal mix of 4-gallon and 1-gallon glue containers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Coverage Info */}
              <div className="p-4 rounded-lg bg-blue-50 border border-blue-100">
                <p className="text-sm text-blue-800">
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
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 h-12"
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
                  className="space-y-4 pt-4 border-t border-slate-200"
                >
                  <h3 className="font-semibold text-slate-800 text-lg">Order Recommendation</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 4-Gallon Containers */}
                    <div className="p-6 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100">
                      <div className="flex items-center gap-3 mb-2">
                        <Package className="w-6 h-6 text-indigo-600" />
                        <p className="text-sm font-medium text-indigo-600">4-Gallon Containers</p>
                      </div>
                      <p className="text-4xl font-bold text-slate-800">{result.fourGallon}</p>
                      <p className="text-sm text-slate-500 mt-1">
                        {result.fourGallon * 4} gallons total
                      </p>
                    </div>

                    {/* 1-Gallon Containers */}
                    <div className="p-6 rounded-xl bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-100">
                      <div className="flex items-center gap-3 mb-2">
                        <Package className="w-6 h-6 text-blue-600" />
                        <p className="text-sm font-medium text-blue-600">1-Gallon Containers</p>
                      </div>
                      <p className="text-4xl font-bold text-slate-800">{result.oneGallon}</p>
                      <p className="text-sm text-slate-500 mt-1">
                        {result.oneGallon} {result.oneGallon === 1 ? 'gallon' : 'gallons'} total
                      </p>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="p-4 rounded-lg bg-slate-50 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Total Gallons:</span>
                      <span className="font-semibold text-slate-800">{result.totalGallons.toFixed(2)} gal</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Total Coverage:</span>
                      <span className="font-semibold text-slate-800">{result.actualCoverage.toFixed(0)} sq ft</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Excess Coverage:</span>
                      <span className="font-semibold text-green-600">+{result.excess.toFixed(0)} sq ft</span>
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