const assets = [
  {
    name: "Thank You Cards",
    url: "https://drive.google.com/drive/folders/12DwhyifExUIhxGX39OzqisEhlKagMA1-",
  },
  {
    name: "Top Box Dieline",
    url: "https://drive.google.com/drive/folders/1lIrDbvkzUE_niwuEBdk_-wsr7LTAkZqw",
  },
  {
    name: "Brand Manual",
    url: "https://drive.google.com/drive/folders/1fwj5_4B9k6vDSwcofkoZU3RcmUAtKNFo",
  },
  {
    name: "All Product Catalogs",
    url: "https://drive.google.com/drive/folders/13grj3xv1JZWxkcfA9ujqJ5Nv3Q6lBvz7",
  },
];

export default function Assets() {
  return (
    <div className="text-gray py-20 px-6">
      <h1 className="text-2xl md:text-4xl font-bold text-center mb-12">
        Brand Assets - Google Drive
      </h1>

      <div className="max-w-5xl mx-auto grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {assets.map((asset, index) => (
          <div
            key={index}
            className="bg-gray-50 rounded-xl shadow-sm text-center p-6 hover:shadow-lg"
          >
            <h2 className="text-xl font-semibold mb-4">{asset.name}</h2>

            <a
              href={asset.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-gray-700 text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition"
            >
              View / Download
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
