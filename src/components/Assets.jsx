import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export default function Assets() {
  const [assets, setAssets] = useState([]);

  useEffect(() => {
    const fetchAssets = async () => {
      const { data, error } = await supabase
        .from("download_assets")
        .select("*")
        .order("name", { ascending: true });
      console.log(data, error);
      if (data) setAssets(data);
    };

    fetchAssets();
  }, []);

  return (
    <div id="assets" className="text-gray bg-[#eef2e8] py-20 px-6">
      <h1 className="text-2xl md:text-4xl font-bold text-center mb-12">
        Brand Assets - Google Drive
      </h1>

      <div className="max-w-7xl mx-auto grid gap-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {assets.map((asset) => (
          <div
            key={asset.id}
            className="group bg-[#eef2e8] border border-gray-200 rounded-2xl p-5 md:p-6 flex flex-row md:flex-col items-center md:items-start justify-between md:justify-between shadow-sm hover:shadow-lg transition-all duration-300 gap-4"
          >
            <h2 className="text-base md:text-lg font-semibold text-gray-800 leading-snug text-left">
              {asset.name}
            </h2>

            <a
              href={asset.url}
              target="_blank"
              rel="noopener noreferrer"
              className="whitespace-nowrap inline-flex items-center justify-center text-sm font-medium text-white bg-gray-800 px-4 py-2 rounded-lg group-hover:bg-black transition"
            >
              Download
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
