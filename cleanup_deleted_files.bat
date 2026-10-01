@echo off
rem WolbiRides: removes files retired by this update. Run once from the project root
rem AFTER extracting this zip over your project:
rem     cleanup_deleted_files.bat

cd /d "%~dp0"

echo Removing the old inline map picker (replaced by LocationPickerModal.tsx)...
del /q "frontend\wolbirides_web_passenger\src\components\PinPicker.tsx" 2>nul
del /q "frontend\wolbirides_web_passenger\src\components\PinPicker.css" 2>nul

echo Removing the old rider mobile inline map picker (replaced by LocationPickerModal.tsx)...
del /q "mobile\wolbirides_mobile_passenger\src\components\PinPickerMap.tsx" 2>nul

echo Removing the old RateRider components (renamed RatePassenger: the rider rates the passenger)...
del /q "frontend\wolbirides_web_driver\src\components\RateRider.tsx" 2>nul
del /q "mobile\wolbirides_mobile_driver\src\components\RateRider.tsx" 2>nul

echo Done.
