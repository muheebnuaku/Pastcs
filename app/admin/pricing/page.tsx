'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, Button } from '@/components/ui';
import { DollarSign, Save, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

const LEVELS = [100, 200, 300, 400] as const;

export default function AdminPricingPage() {
  const [prices, setPrices] = useState<Record<number, string>>({
    100: '50',
    200: '50',
    300: '50',
    400: '50',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/pricing')
      .then(r => r.json())
      .then(data => {
        if (data.prices) {
          const display: Record<number, string> = {};
          for (const level of LEVELS) {
            // Convert from pesewas to GHC
            display[level] = String((data.prices[level] ?? 5000) / 100);
          }
          setPrices(display);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    setSuccess('');

    // Validate inputs
    for (const level of LEVELS) {
      const val = parseFloat(prices[level]);
      if (isNaN(val) || val <= 0) {
        setError(`Invalid price for Level ${level}`);
        setIsSaving(false);
        return;
      }
    }

    try {
      // Convert GHC → pesewas (multiply by 100)
      const pesewas: Record<number, number> = {};
      for (const level of LEVELS) {
        pesewas[level] = Math.round(parseFloat(prices[level]) * 100);
      }

      const res = await fetch('/api/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prices: pesewas }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setSuccess('Prices updated successfully!');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save prices');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Subscription Pricing</h1>
        <p className="text-gray-600">Set the subscription price per academic level. Prices shown in GHC.</p>
      </div>

      <Card className="max-w-lg">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-blue-600" />
            Price Per Level (GHC)
          </h2>
        </div>
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading prices...
            </div>
          ) : (
            <>
              {LEVELS.map(level => (
                <div key={level} className="flex items-center gap-4">
                  <div className="w-28 flex-shrink-0">
                    <span className="font-semibold text-gray-800">Level {level}</span>
                    <p className="text-xs text-gray-400">Semester 1 &amp; 2</p>
                  </div>
                  <div className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm">
                      GHC
                    </span>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      value={prices[level]}
                      onChange={e => setPrices(prev => ({ ...prev, [level]: e.target.value }))}
                      className="w-full pl-12 pr-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              ))}

              {error && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg p-3 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {success && (
                <div className="flex items-center gap-2 text-green-600 bg-green-50 rounded-lg p-3 text-sm">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  {success}
                </div>
              )}

              <Button onClick={handleSave} disabled={isSaving} className="w-full">
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Prices
                  </>
                )}
              </Button>

              <p className="text-xs text-gray-400 text-center">
                Changes take effect immediately for new payments.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
