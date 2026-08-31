import { useEffect, useState } from "react";
import { Eye, FileText, Plus, X } from "lucide-react";
import { toast } from "react-toastify";
import { supabase } from "./supabase";
import SectionHeader from "./SectionHeader";

export default function Assets() {
  const [assets, setAssets] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const canEdit = localStorage.getItem("auth") === "true";

  const fetchAssets = async () => {
    const { data, error } = await supabase
      .from("download_assets")
      .select("*")
      .order("name", { ascending: true });
    if (error) {
      console.error(error);
      return;
    }
    if (data) setAssets(data);
  };

  useEffect(() => {
    fetchAssets();
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return;

    setSaving(true);
    const { data, error } = await supabase
      .from("download_assets")
      .insert({ name: title.trim(), url: url.trim() })
      .select()
      .single();
    setSaving(false);

    if (error) {
      toast.error("Couldn't add that link. Check the Supabase setup.");
      console.error(error);
      return;
    }

    toast.success("Link added");
    setAssets((prev) =>
      [...prev, data].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setTitle("");
    setUrl("");
    setShowAddForm(false);
  };

  return (
    <div id="assets" className="text-gray bg-[#eef2e8] py-8 lg:py-10">
      <SectionHeader title="Brand assets" subtitle="Stored in Google Drive" />

      {canEdit && (
        <div className="mb-6">
          {!showAddForm ? (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 text-sm font-medium border border-gray-300 hover:bg-white rounded-md px-3 py-1.5 transition"
            >
              <Plus size={14} />
              Add link
            </button>
          ) : (
            <form
              onSubmit={handleAdd}
              className="bg-white border border-black/5 rounded-xl shadow-sm p-4 sm:p-5 flex flex-col gap-3 max-w-md"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Add a link</h3>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="opacity-60 hover:opacity-100"
                >
                  <X size={16} />
                </button>
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title, e.g. Packaging Reorder Sheet"
                required
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#2e4034]"
              />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://drive.google.com/..."
                required
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#2e4034]"
              />
              <button
                type="submit"
                disabled={saving}
                className="self-start bg-[#2e4034] hover:bg-[#243329] text-white text-sm font-medium px-4 py-1.5 rounded-md transition disabled:opacity-50"
              >
                {saving ? "Adding..." : "Add"}
              </button>
            </form>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {assets.map((asset) => (
          <div
            key={asset.id}
            className="flex items-center gap-3.5 bg-white border border-black/5 rounded-xl p-4 hover:border-brown/40 transition"
          >
            <div className="shrink-0 w-9 h-9 rounded-lg bg-[#eef2e8] flex items-center justify-center text-[#2e4034]">
              <FileText size={17} />
            </div>

            <h3 className="flex-1 min-w-0 text-sm font-medium text-gray-800 leading-snug truncate">
              {asset.name}
            </h3>

            <a
              href={asset.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${asset.name}`}
              title="View"
              className="shrink-0 w-8 h-8 rounded-lg bg-[#2e4034] text-white flex items-center justify-center hover:bg-brown transition"
            >
              <Eye size={14} />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
