// Latitude / longitude bounds, mirroring the backend range check in
// services/geolocations.py (validate_coordinates). Named so the submit-form
// validation reads against a single source instead of bare magic numbers.
export const LAT_MIN = -90;
export const LAT_MAX = 90;
export const LNG_MIN = -180;
export const LNG_MAX = 180;
