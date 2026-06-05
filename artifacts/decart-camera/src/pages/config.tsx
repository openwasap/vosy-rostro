import { useState, useEffect } from "react";
import { ArrowLeft, Save, Key, Type, Sparkles } from "lucide-react";
import { Link } from "wouter";

const API_BASE = "/api";

export default function ConfigPage() {
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("Anime style portrait");
  const [model, setModel] = useState("lucy-2.1");
  const [mirror, setMirror] = useState("auto");
  const [enhance, setEnhance] = useState(true);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load current config
    fetch(`${API_BASE}/decart/config`)
      .then((res) => res.json())
      .then((data) => {
        if (data.prompt) setPrompt(data.prompt);
        if (data.model) setModel(data.model);
        if (data.mirror) setMirror(data.mirror);
        if (data.enhance !== undefined) setEnhance(data.enhance);
      })
      .catch(() => {});
  }, []);

  const saveConfig = async () => {
    setLoading(true);
    try {
      await fetch(`${API_BASE}/decart/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          prompt,
          model,
          mirror,
          enhance,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Error saving config:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gray-900">
        <div className="flex items-center gap-2">
          <Link href="/">
            <button className="p-2 text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
          </Link>
          <h1 className="text-lg font-semibold text-white">Configuración</h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 max-w-2xl mx-auto w-full space-y-6">
        {/* Decart AI Section */}
        <div className="bg-gray-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Decart AI</h2>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400 flex items-center gap-2">
              <Key className="w-4 h-4" />
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Tu API key de Decart AI"
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500">
              Obtén tu API key en https://decart.ai
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400 flex items-center gap-2">
              <Type className="w-4 h-4" />
              Prompt de filtro
            </label>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ej: Anime style portrait"
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500">
              Describe cómo quieres que se vea el video filtrado
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400">Modelo</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
            >
              <option value="lucy-2.1">Lucy 2.1</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400">Espejo</label>
            <select
              value={mirror}
              onChange={(e) => setMirror(e.target.value)}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
            >
              <option value="auto">Auto</option>
              <option value="true">Siempre</option>
              <option value="false">Nunca</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enhance"
              checked={enhance}
              onChange={(e) => setEnhance(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600"
            />
            <label htmlFor="enhance" className="text-sm text-gray-400">
              Mejorar calidad (enhance)
            </label>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={saveConfig}
          disabled={loading}
          className="w-full bg-purple-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Save className="w-5 h-5" />
          {loading ? "Guardando..." : saved ? "¡Guardado!" : "Guardar configuración"}
        </button>

        {/* Info */}
        <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-400">
          <h3 className="font-semibold text-gray-300 mb-2">Sobre Decart AI</h3>
          <p className="mb-2">
            Decart AI proporciona filtros de video en tiempo real usando inteligencia artificial.
          </p>
          <p className="mb-2">
            Costo: 2 créditos por segundo de procesamiento.
          </p>
          <p>
            Visita <a href="https://decart.ai" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">decart.ai</a> para obtener tu API key y créditos.
          </p>
        </div>
      </div>
    </div>
  );
}
