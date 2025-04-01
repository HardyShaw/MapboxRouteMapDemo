import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  Image,
} from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import GetLocation from 'react-native-get-location';
import Autocomplete from 'react-native-autocomplete-input';
import {Images} from '../assests/images';

// Replace with your Mapbox access token
const MAPBOX_ACCESS_TOKEN = 'PUBLIC ACCESS TOKEN';

const NavigationApp: React.FC = () => {
  const [currentLocation, setCurrentLocation] = useState<
    [number, number] | null
  >(null);
  const [destination, setDestination] = useState<[number, number] | null>(null);
  const [route, setRoute] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [distance, setDistance] = useState<string | null>(null);
  const [duration, setDuration] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<
    {name: string; coords: [number, number]}[]
  >([]);
  const [isNavigating, setIsNavigating] = useState(false);
  const [loading, setLoading] = useState(true);

  const cameraRef = useRef<MapboxGL.Camera>(null);
  const mapRef = useRef<MapboxGL.MapView>(null);
  const locationInterval = useRef<NodeJS.Timeout | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    const initialize = async () => {
      try {
        await requestLocationPermission();
      } catch (error) {
        console.error('Initialization error:', error);
        if (isMounted.current) setLoading(false);
      }
    };
    initialize();

    return () => {
      isMounted.current = false;
      if (locationInterval.current) {
        clearInterval(locationInterval.current);
      }
    };
  }, []);

  useEffect(() => {
    if (currentLocation && destination && isNavigating) {
      fetchRoute();
      startNavigationTracking();
    }
  }, [currentLocation, destination, isNavigating]);

  const requestLocationPermission = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        await getCurrentLocation();
      }
    } else {
      await getCurrentLocation();
    }
  };

  const getCurrentLocation = async () => {
    try {
      const location = await GetLocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
      });
      if (isMounted.current) {
        setCurrentLocation([location.longitude, location.latitude]);
        setLoading(false);
      }
    } catch (error) {
      console.error('Location error:', error);
      if (isMounted.current) setLoading(false);
    }
  };

  const fetchRoute = useCallback(
    async (
      start: [number, number] = currentLocation!,
      end: [number, number] = destination!,
    ) => {
      if (!start || !end || !isMounted.current) return;

      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start[0]},${start[1]};${end[0]},${end[1]}?geometries=geojson&steps=true&access_token=${MAPBOX_ACCESS_TOKEN}`;

      try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.routes?.length && isMounted.current) {
          setRoute(data.routes[0].geometry);
          setDistance((data.routes[0].distance / 1000).toFixed(1));
          setDuration(`${Math.round(data.routes[0].duration / 60)} min`);
          setSteps(data.routes[0].legs[0].steps);
        }
      } catch (error) {
        console.error('Route fetch error:', error);
      }
    },
    [currentLocation, destination],
  );

  const fetchSuggestions = async (input: string) => {
    if (!input || !isMounted.current) {
      setSuggestions([]);
      return;
    }

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      input,
    )}.json?access_token=${MAPBOX_ACCESS_TOKEN}&autocomplete=true&limit=5`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.features && isMounted.current) {
        const places = data.features.map((feature: any) => ({
          name: feature.place_name,
          coords: feature.center as [number, number],
        }));
        setSuggestions(places);
      }
    } catch (error) {
      console.error('Suggestions error:', error);
    }
  };

  const startNavigationTracking = useCallback(() => {
    if (locationInterval.current) {
      clearInterval(locationInterval.current);
    }

    locationInterval.current = setInterval(async () => {
      try {
        const location = await GetLocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
        });
        const newLocation: [number, number] = [
          location.longitude,
          location.latitude,
        ];
        if (isMounted.current) {
          setCurrentLocation(newLocation);
          updateNavigation(newLocation);
        }
      } catch (error) {
        console.error('Tracking error:', error);
      }
    }, 3000);
  }, []);

  const updateNavigation = (location: [number, number]) => {
    if (!steps.length || !cameraRef.current || !isMounted.current) return;

    const currentStep = steps[currentStepIndex];
    const distanceToStep = calculateDistance(
      location,
      currentStep.maneuver.location.coordinates,
    );

    if (distanceToStep < 0.03) {
      if (currentStepIndex < steps.length - 1) {
        handleNextStep(currentStepIndex + 1);
      } else {
        stopNavigation();
      }
    }

    cameraRef.current.setCamera({
      centerCoordinate: location,
      heading: getBearing(
        location,
        steps[currentStepIndex].maneuver.location.coordinates,
      ),
      zoomLevel: 16,
      animationDuration: 1000,
    });
  };

  const handleNextStep = (stepIndex: number) => {
    if (
      stepIndex >= steps.length ||
      !currentLocation ||
      !cameraRef.current ||
      !isMounted.current
    )
      return;

    setCurrentStepIndex(stepIndex);
    const stepDestination = steps[stepIndex].maneuver.location.coordinates as [
      number,
      number,
    ];

    fetchRoute(currentLocation, stepDestination);

    cameraRef.current.setCamera({
      centerCoordinate: stepDestination,
      zoomLevel: 16,
      animationDuration: 1000,
    });
  };

  const stopNavigation = async () => {
    if (!isMounted.current) return;

    setIsNavigating(false);
    setCurrentStepIndex(0);
    setRoute(null);
    setSteps([]);
    setDistance(null);
    setDuration(null);

    if (locationInterval.current) {
      clearInterval(locationInterval.current);
    }

    try {
      const location = await GetLocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
      });
      const newLocation: [number, number] = [
        location.longitude,
        location.latitude,
      ];
      if (isMounted.current) {
        setCurrentLocation(newLocation);
        if (cameraRef.current) {
          cameraRef.current.setCamera({
            centerCoordinate: newLocation,
            zoomLevel: 12,
            animationDuration: 1000,
          });
        }
      }
    } catch (error) {
      console.error('Stop navigation location error:', error);
    }
  };

  const calculateDistance = (
    coord1: [number, number],
    coord2: [number, number],
  ) => {
    const [lon1, lat1] = coord1;
    const [lon2, lat2] = coord2;
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 2;
  };

  const getBearing = (start: [number, number], end: [number, number]) => {
    const [startLon, startLat] = start;
    const [endLon, endLat] = end;
    const dLon = (endLon - startLon) * (Math.PI / 180);
    const y = Math.sin(dLon) * Math.cos(endLat * (Math.PI / 180));
    const x =
      Math.cos(startLat * (Math.PI / 180)) *
        Math.sin(endLat * (Math.PI / 180)) -
      Math.sin(startLat * (Math.PI / 180)) *
        Math.cos(endLat * (Math.PI / 180)) *
        Math.cos(dLon);
    return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
  };

  const startNavigation = () => {
    if (currentLocation && destination && isMounted.current) {
      setIsNavigating(true);
      setCurrentStepIndex(0);
      fetchRoute();
    }
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator
          size="large"
          color="#0000ff"
          style={styles.loading}
        />
      ) : (
        <>
          <View style={styles.searchContainer}>
            <Autocomplete
              data={suggestions}
              value={query}
              onChangeText={text => {
                setQuery(text);
                fetchSuggestions(text);
              }}
              placeholder="Enter destination"
              containerStyle={styles.autocompleteContainer}
              inputContainerStyle={styles.inputContainer}
              flatListProps={{
                keyboardShouldPersistTaps: 'always',
                keyExtractor: item => item.name,
                renderItem: ({item}) => (
                  <TouchableOpacity
                    style={styles.suggestionItem}
                    onPress={() => {
                      if (isMounted.current) {
                        setQuery(item.name);
                        setDestination(item.coords);
                        setSuggestions([]);
                      }
                    }}>
                    <Text style={styles.suggestionText}>{item.name}</Text>
                  </TouchableOpacity>
                ),
              }}
            />
          </View>

          <MapboxGL.MapView
            ref={mapRef}
            style={styles.map}
            styleURL={MapboxGL.StyleURL.Street}>
            <MapboxGL.Camera
              ref={cameraRef}
              centerCoordinate={currentLocation || [-122.4194, 37.7749]}
              zoomLevel={isNavigating ? 16 : 12}
              followUserLocation={isNavigating}
              followUserMode="course"
            />

            {currentLocation && (
              <MapboxGL.PointAnnotation
                id="current"
                coordinate={currentLocation}
                anchor={{x: 0.5, y: 1}}
                style={{zIndex: 1000}}>
                <Image source={Images.location} style={styles.marker} />
              </MapboxGL.PointAnnotation>
            )}

            {destination && (
              <MapboxGL.PointAnnotation
                id="destination"
                coordinate={destination}
                anchor={{x: 0.5, y: 1}}
                style={{zIndex: 1000}}>
                <Image source={Images.location} style={styles.marker} />
              </MapboxGL.PointAnnotation>
            )}

            {steps.map(
              (step, index) =>
                index !== 0 &&
                index <= currentStepIndex && (
                  <MapboxGL.PointAnnotation
                    key={`step-${index}`}
                    id={`step-${index}`}
                    coordinate={step.maneuver.location.coordinates}
                    anchor={{x: 0.5, y: 1}}
                    style={{zIndex: 900}}>
                    <View style={styles.stepMarker}>
                      <Text style={styles.stepMarkerText}>{index}</Text>
                    </View>
                  </MapboxGL.PointAnnotation>
                ),
            )}

            {route && (
              <MapboxGL.ShapeSource
                id="routeSource"
                shape={{type: 'Feature', geometry: route}}>
                <MapboxGL.LineLayer
                  id="routeLayer"
                  style={{lineColor: '#007AFF', lineWidth: 4, lineOpacity: 0.8}}
                />
              </MapboxGL.ShapeSource>
            )}
          </MapboxGL.MapView>

          {isNavigating && steps.length > 0 && (
            <>
              <TouchableOpacity
                style={styles.navigationPanel}
                onPress={() => handleNextStep(currentStepIndex + 1)}
                disabled={currentStepIndex >= steps.length - 1}>
                <Text style={styles.instruction}>
                  {steps[currentStepIndex].maneuver.instruction}
                </Text>
                <Text style={styles.stepDistance}>
                  In{' '}
                  {steps[currentStepIndex].distance > 1000
                    ? (steps[currentStepIndex].distance / 1000).toFixed(1) +
                      ' km'
                    : Math.round(steps[currentStepIndex].distance) + ' m'}
                </Text>
                <Text style={styles.nextText}>
                  {currentStepIndex < steps.length - 1
                    ? 'Tap for next step'
                    : 'Destination reached'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.stopButton}
                onPress={stopNavigation}>
                <Text style={styles.stopButtonText}>Stop</Text>
              </TouchableOpacity>
            </>
          )}

          {!isNavigating && distance && duration && (
            <View style={styles.routeInfo}>
              <Text style={styles.infoText}>Distance: {distance} km</Text>
              <Text style={styles.infoText}>ETA: {duration}</Text>
            </View>
          )}

          {!isNavigating && (
            <TouchableOpacity
              style={[styles.button, !destination && styles.buttonDisabled]}
              onPress={startNavigation}
              disabled={!destination}>
              <Text style={styles.buttonText}>Start Navigation</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    zIndex: 10,
  },
  autocompleteContainer: {
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  inputContainer: {
    borderWidth: 0,
    padding: 10,
  },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  suggestionText: {
    fontSize: 16,
  },
  map: {
    flex: 1,
  },
  marker: {
    width: 32,
    height: 32,
    zIndex: 1000,
  },
  stepMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepMarkerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  navigationPanel: {
    position: 'absolute',
    top: 80,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 15,
    borderRadius: 8,
    elevation: 4,
  },
  instruction: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 5,
  },
  stepDistance: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  nextText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  routeInfo: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 15,
    borderRadius: 8,
    elevation: 4,
    alignItems: 'center',
  },
  infoText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginVertical: 2,
  },
  button: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  stopButton: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: '#FF3B30',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});

export default NavigationApp;
