/* eslint-disable no-unused-vars */
import { useState, useRef } from "react";
import { supabase } from "./supabase";
import { Upload, Plus } from "lucide-react";

const Uploads = ({ onUploadSuccess }) => {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const inputRef = useRef();

  const handleUpload = async () => {
    if (!file) return;

    const filePath = `uploads/${Date.now()}-${file.name}`;

    const { data, error } = await supabase.storage
      .from("assets")
      .upload(filePath, file);

    if (error) {
      setMessage("❌ Upload failed");
      console.log(error);
      return;
    }

    setMessage("✅ Upload successful");

    // clear input + state
    setFile(null);
    inputRef.current.value = "";

    // refresh file list
    onUploadSuccess();
  };

  return (
    <div className="flex items-center flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png"
        onChange={(e) => setFile(e.target.files[0])}
        className="hidden"
      />

      <div className="flex items-center gap-4">
        {/* Choose file box */}
        <div
          onClick={() => inputRef.current.click()}
          className="border-2 border-dashed border-gray-300 rounded-lg px-5 py-3 flex items-center gap-2 cursor-pointer hover:border-gray-400 transition"
        >
          <span className="text-xs">{file ? file.name : " + Choose file"}</span>
        </div>

        {/* Upload button */}
        <button
          onClick={handleUpload}
          className={`btn btn-outline px-5 btn-sm rounded-full flex items-center gap-2 
          ${!file ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          <Upload size={15} />
          Upload
        </button>
      </div>
      {message && <p className="text-sm">{message}</p>}
    </div>
  );
};

export default Uploads;
