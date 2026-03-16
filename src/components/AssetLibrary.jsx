import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";
import Upload from "./Upload";

const AssetLibrary = () => {
  const [files, setFiles] = useState([]);

  const loadFiles = useCallback(async () => {
    const { data, error } = await supabase.storage
      .from("assets")
      .list("uploads", { limit: 100 });

    if (error) {
      console.error(error);
      return;
    }

    const realFiles = data.filter(
      (item) =>
        item.name !== ".emptyFolderPlaceholder" &&
        item.name !== ".emptyFolderPlaceholder.txt",
    );

    setFiles(realFiles);
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const getPublicUrl = (name) => {
    const { data } = supabase.storage
      .from("assets")
      .getPublicUrl(`uploads/${name}`);

    return data.publicUrl;
  };

  const handleDownload = async (name) => {
    const { data, error } = await supabase.storage
      .from("assets")
      .createSignedUrl(`uploads/${name}`, 60, {
        download: name.split("-").slice(1).join("-"),
      });

    if (error) {
      console.error(error);
      return;
    }

    window.open(data.signedUrl, "_blank");
  };

  const cleanName = (name) => {
    return name.split("-").slice(1).join("-");
  };

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8 max-w-7xl mx-auto text-gray-800">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold">Downloads</h1>

        <p className="text-sm opacity-70 mt-1 max-w-xl">
          Access brand assets, documents, and resources – upload smaller files
          here
        </p>
      </div>

      {/* Upload section */}
      <div className="flex flex-col sm:flex-row sm:justify-end mb-8">
        <div className="bg-white rounded-xl shadow-sm p-4 sm:p-5 w-full sm:w-auto">
          <Upload onUploadSuccess={loadFiles} />
        </div>
      </div>

      {/* Files grid */}
      {files.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg font-medium">No files available</p>
          <p className="text-sm mt-1">
            Upload assets to make them downloadable.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {files.map((file) => {
            const niceName = cleanName(file.name);

            return (
              <div
                key={file.name}
                className="bg-white rounded-xl shadow-sm p-4 sm:p-5 flex flex-col items-center justify-between hover:shadow-md transition"
              >
                {/* File name */}
                <div className="flex items-center gap-1.5 mb-4">
                  <div className="text-md md:text-lg">📄</div>

                  <p className="text-sm font-medium break-all">{niceName}</p>
                </div>

                {/* Download */}
                <button
                  onClick={() => handleDownload(file.name)}
                  className="btn btn-outline btn-sm rounded-full w-36 sm:w-full"
                >
                  Download
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AssetLibrary;
