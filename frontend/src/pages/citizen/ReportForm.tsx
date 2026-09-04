import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createReport, uploadFile } from '../../api/client';
import IncidentMap from '../../components/IncidentMap';

export default function ReportForm() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'photo' | 'video'>('photo');

  const handleGetLocation = () => {
    setGettingLocation(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setGettingLocation(false);
        },
        () => {
          // Fallback to Bengaluru coordinates for demo
          setGps({ lat: 12.9716, lng: 77.5946 });
          setGettingLocation(false);
        }
      );
    } else {
      setGps({ lat: 12.9716, lng: 77.5946 });
      setGettingLocation(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      setError('Please select a photo or video file');
      return;
    }

    // Validate file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      setError('File size must be less than 50MB');
      return;
    }

    setSelectedFile(file);
    setMediaType(isVideo ? 'video' : 'photo');
    setError('');

    // Create preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setError('Please select a photo or video to upload');
      return;
    }
    setLoading(true);
    setError('');

    try {
      // Step 1: Upload the file to the server
      const { url } = await uploadFile(selectedFile);

      // Step 2: Create the report with the uploaded file URL
      await createReport({
        media_url: url,
        media_type: mediaType,
        gps: gps || { lat: 12.9716, lng: 77.5946 },
        address: address || undefined,
        description: description || undefined,
      });

      navigate('/citizen');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Report Road Damage</h1>
      <p className="text-sm text-gray-500 mb-6">Upload a photo or video and describe the issue. It takes less than a minute.</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Photo/Video upload area */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="bg-white rounded-xl border-2 border-dashed border-gray-300 p-8 text-center hover:border-indigo-400 transition-colors cursor-pointer"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {previewUrl ? (
            <div>
              {mediaType === 'video' ? (
                <video src={previewUrl} className="w-full h-48 object-cover rounded-lg mb-3" controls />
              ) : (
                <img src={previewUrl} alt="Preview" className="w-full h-48 object-cover rounded-lg mb-3" />
              )}
              <p className="text-sm text-green-600 font-medium">✅ File selected: {selectedFile?.name}</p>
              <p className="text-xs text-gray-400 mt-1">Click to change file</p>
            </div>
          ) : (
            <>
              <div className="text-4xl mb-2">📸</div>
              <p className="text-sm text-gray-600 font-medium">Tap to upload photo or video</p>
              <p className="text-xs text-gray-400 mt-1">JPG, PNG, MP4 up to 50MB</p>
            </>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Big pothole near the bus stop, two-wheelers keep swerving..."
            rows={3}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
          />
        </div>

        {/* Address */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Address / Landmark (optional)</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. Outer Ring Road, near Marathahalli Bridge"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        {/* GPS */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Location</label>
          <button
            type="button"
            onClick={handleGetLocation}
            disabled={gettingLocation}
            className="w-full px-4 py-3 bg-gray-100 border border-gray-300 rounded-lg text-sm text-left hover:bg-gray-50 transition-colors"
          >
            {gps ? (
              <span className="text-green-600">✅ Location set: {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</span>
            ) : gettingLocation ? (
              <span className="text-gray-500">📍 Getting your location...</span>
            ) : (
              <span className="text-gray-600">📍 Get current location</span>
            )}
          </button>
        </div>

        {/* Map Preview */}
        {gps && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Location Preview</label>
            <IncidentMap
              center={gps}
              markerLabel="Incident Location"
              className="h-48"
            />
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading || !selectedFile}
          className="w-full py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Submitting...
            </>
          ) : (
            '📸 Submit Report'
          )}
        </button>
      </form>
    </div>
  );
}
