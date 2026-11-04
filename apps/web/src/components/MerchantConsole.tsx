import React from 'react';
import { BarChart3, TrendingUp, Users, AlertCircle, ShoppingCart } from 'lucide-react';

export default function MerchantConsole() {
  return (
    <div className="bg-white min-h-screen font-sans text-slate-800 p-8">
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Partner Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Aalter Studio · Data feed active</p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="px-4 py-2 rounded-lg bg-green-50 text-green-700 text-xs font-bold border border-green-100 flex items-center">
            <span className="w-2 h-2 rounded-full bg-green-500 mr-2" /> Live
          </div>
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
            <Users className="w-5 h-5" />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {[
          { label: 'Try-ons', value: '12.4k', trend: '+12%', icon: TrendingUp },
          { label: 'Conversion', value: '4.8%', trend: '+0.5%', icon: ShoppingCart },
          { label: 'Return Rate', value: '1.2%', trend: '-2.4%', icon: BarChart3, ok: true },
          { label: 'Conflicts', value: '14', trend: 'Critical', icon: AlertCircle, warn: true }
        ].map((stat, i) => (
          <div key={i} className="p-6 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 rounded-lg bg-white shadow-sm">
                <stat.icon className="w-5 h-5 text-slate-400" />
              </div>
              <span className={`text-[10px] font-bold uppercase ${stat.ok ? 'text-green-500' : stat.warn ? 'text-rose-500' : 'text-blue-500'}`}>
                {stat.trend}
              </span>
            </div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">{stat.label}</h3>
            <p className="text-3xl font-bold text-slate-900">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-100">
          <h3 className="text-sm font-bold uppercase tracking-widest mb-6">Size Heatmap — Linen Wrap Dress</h3>
          <div className="space-y-4">
            {[
              { size: 'XS', fit: 88, return: 2 },
              { size: 'S', fit: 92, return: 1 },
              { size: 'M', fit: 95, return: 1 },
              { size: 'L', fit: 64, return: 8 }
            ].map((row) => (
              <div key={row.size} className="space-y-2">
                <div className="flex justify-between text-xs font-bold">
                  <span>Size {row.size}</span>
                  <span className={row.return > 5 ? 'text-rose-500' : 'text-green-500'}>{row.fit}% Confidence</span>
                </div>
                <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${row.return > 5 ? 'bg-rose-400' : 'bg-slate-800'}`} style={{ width: `${row.fit}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-8 text-xs text-slate-400 leading-relaxed italic">
            * Note: Size L shows high return intent in DressingRoom. Fit engine suggests ease at bust is +2cm wider than actual garment cut. Action: Review pattern block L.
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 flex flex-col items-center justify-center border-dashed">
           <AlertCircle className="w-12 h-12 text-slate-200 mb-4" />
           <p className="text-sm font-medium text-slate-400">Garment Metrics Engine (GME) V2 available</p>
           <button className="mt-4 px-6 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold shadow-lg shadow-slate-900/10">
             Run Simulation
           </button>
        </div>
      </div>
    </div>
  );
}
