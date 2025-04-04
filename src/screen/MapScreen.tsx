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
  useColorScheme,
} from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import GetLocation from 'react-native-get-location';
import Autocomplete from 'react-native-autocomplete-input';
import {PUBLIC_KEY} from '@env';
import {Images} from '../assests/images';

const MAPBOX_ACCESS_TOKEN = `${PUBLIC_KEY}`;

const NavigationApp: React.FC = () => {
  const [currentLocation, setCurrentLocation] = useState<
    [number, number] | null
  >(null);
  const [destination, setDestination] = useState<[number, number] | null>(null);
  const [route, setRoute] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [routeInfo, setRouteInfo] = useState<{
    distance: string | null;
    duration: string | null;
    remainingDistance: string | null;
    remainingDuration: string | null;
  }>({
    distance: null,
    duration: null,
    remainingDistance: null,
    remainingDuration: null,
  });
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<
    {name: string; coords: [number, number]}[]
  >([]);
  const [isNavigating, setIsNavigating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMapInteracting, setIsMapInteracting] = useState(false);
  const [currentHeading, setCurrentHeading] = useState<number>(0);

  const colorScheme = useColorScheme();
  const cameraRef = useRef<MapboxGL.Camera | null>(null);
  const locationInterval = useRef<NodeJS.Timeout | null>(null);
  const isMounted = useRef(true);
  const isLocationRequestPending = useRef(false);

  // Function to format minutes to hh:mm
  const formatDuration = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours.toString().padStart(2, '0')}:${mins
      .toString()
      .padStart(2, '0')}`;
  };

  const fetchRoute = useCallback(
    async (start: [number, number], end: [number, number]) => {
      if (!start || !end || !isMounted.current) return;

      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start[0]},${start[1]};${end[0]},${end[1]}?geometries=geojson&steps=true&access_token=${MAPBOX_ACCESS_TOKEN}`;

      try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.routes?.length && isMounted.current) {
          const routeData = data.routes[0];
          const totalMinutes = routeData.duration / 60;
          setRoute(routeData.geometry);
          setRouteInfo({
            distance: (routeData.distance / 1000).toFixed(1),
            duration: formatDuration(totalMinutes),
            remainingDistance: (routeData.distance / 1000).toFixed(1),
            remainingDuration: formatDuration(totalMinutes),
          });
          setSteps(routeData.legs[0].steps);

          if (!isNavigating && cameraRef.current) {
            cameraRef.current.fitBounds(
              [Math.min(start[0], end[0]), Math.min(start[1], end[1])],
              [Math.max(start[0], end[0]), Math.max(start[1], end[1])],
              120,
              1000,
            );
          }
        }
      } catch (error) {
        console.error('Route fetch error:', error);
      }
    },
    [isNavigating],
  );

  const fetchSuggestions = useCallback(async (input: string) => {
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
        setSuggestions(
          data.features.map((feature: any) => ({
            name: feature.place_name,
            coords: feature.center as [number, number],
          })),
        );
      }
    } catch (error) {
      console.error('Suggestions error:', error);
    }
  }, []);

  const updateNavigation = useCallback(
    (location: [number, number]) => {
      if (!steps.length || !cameraRef.current || !isMounted.current) return;

      const currentStep = steps[currentStepIndex];
      const distanceToStep = calculateDistance(
        location,
        currentStep.maneuver.location.coordinates,
      );

      let remainingDistance = 0;
      let remainingDuration = 0;
      for (let i = currentStepIndex; i < steps.length; i++) {
        remainingDistance += steps[i].distance;
        remainingDuration += steps[i].duration;
      }

      setRouteInfo(prev => ({
        ...prev,
        remainingDistance: (remainingDistance / 1000).toFixed(1),
        remainingDuration: formatDuration(remainingDuration / 60),
      }));

      if (distanceToStep < 0.03 && currentStepIndex < steps.length - 1) {
        handleStepChange(currentStepIndex + 1);
      } else if (distanceToStep < 0.03) {
        stopNavigation();
      }
    },
    [steps, currentStepIndex],
  );

  const getCurrentPositionSafe = async () => {
    if (isLocationRequestPending.current) return null;

    try {
      isLocationRequestPending.current = true;
      const location = await GetLocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
      });
      return {
        coords: [location.longitude, location.latitude] as [number, number],
        heading: location.course >= 0 ? location.course : 0,
      };
    } catch (error: any) {
      if (error.message?.includes('cancelled')) {
        console.log('Location request cancelled by another request');
      } else {
        console.error('Location error:', error);
      }
      return null;
    } finally {
      isLocationRequestPending.current = false;
    }
  };

  const startNavigationTracking = useCallback(() => {
    if (locationInterval.current) clearInterval(locationInterval.current);

    locationInterval.current = setInterval(async () => {
      if (isMapInteracting || !isMounted.current) return;

      const locationData = await getCurrentPositionSafe();
      if (!locationData) return;

      const {coords, heading} = locationData;
      if (isMounted.current) {
        setCurrentLocation(coords);
        setCurrentHeading(heading);
        updateNavigation(coords);
        if (cameraRef.current) {
          cameraRef.current.setCamera({
            centerCoordinate: coords,
            bearing: heading,
            zoomLevel: 18,
            animationDuration: 500,
          });
        }
      }
    }, 500);
  }, [isMapInteracting, updateNavigation]);

  const handleStepChange = useCallback(
    (newIndex: number) => {
      if (
        newIndex < 0 ||
        newIndex >= steps.length ||
        !currentLocation ||
        !cameraRef.current
      )
        return;

      setCurrentStepIndex(newIndex);
      const stepCoords = steps[newIndex].maneuver.location.coordinates as [
        number,
        number,
      ];

      cameraRef.current.setCamera({
        centerCoordinate: stepCoords,
        bearing: currentHeading,
        zoomLevel: 18,
        animationDuration: 1000,
      });

      fetchRoute(currentLocation, stepCoords);
    },
    [steps, currentLocation, currentHeading, fetchRoute],
  );

  const stopNavigation = useCallback(async () => {
    if (!isMounted.current) return;

    setIsNavigating(false);
    setCurrentStepIndex(0);
    setRoute(null);
    setSteps([]);
    setRouteInfo({
      distance: null,
      duration: null,
      remainingDistance: null,
      remainingDuration: null,
    });

    if (locationInterval.current) {
      clearInterval(locationInterval.current);
      locationInterval.current = null;
    }

    const locationData = await getCurrentPositionSafe();
    if (locationData && isMounted.current && cameraRef.current) {
      setCurrentLocation(locationData.coords);
      setCurrentHeading(locationData.heading);
      cameraRef.current.setCamera({
        centerCoordinate: locationData.coords,
        bearing: locationData.heading,
        zoomLevel: 16,
        animationDuration: 1000,
      });
    }
  }, []);

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

  const startNavigation = useCallback(() => {
    if (currentLocation && destination && cameraRef.current) {
      setIsNavigating(true);
      setCurrentStepIndex(0);
      cameraRef.current.setCamera({
        centerCoordinate: currentLocation,
        bearing: currentHeading,
        zoomLevel: 18,
        animationDuration: 1000,
      });
    }
  }, [currentLocation, destination, currentHeading]);

  useEffect(() => {
    isMounted.current = true;
    const initialize = async () => {
      try {
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
      } catch (error) {
        console.error('Initialization error:', error);
        setLoading(false);
      }
    };
    initialize();

    return () => {
      isMounted.current = false;
      if (locationInterval.current) clearInterval(locationInterval.current);
    };
  }, []);

  useEffect(() => {
    if (currentLocation && destination)
      fetchRoute(currentLocation, destination);
  }, [currentLocation, destination, fetchRoute]);

  useEffect(() => {
    if (isNavigating && currentLocation && destination)
      startNavigationTracking();
  }, [isNavigating, currentLocation, destination, startNavigationTracking]);

  const getCurrentLocation = async () => {
    const locationData = await getCurrentPositionSafe();
    if (locationData && isMounted.current) {
      setCurrentLocation(locationData.coords);
      setCurrentHeading(locationData.heading);
      setLoading(false);
    }
  };

  const isDarkMode = colorScheme === 'dark';
  const textColor = isDarkMode ? '#fff' : '#333';

  return (
    <View
      style={[
        styles.container,
        {backgroundColor: isDarkMode ? '#000' : '#fff'},
      ]}>
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
              containerStyle={[
                styles.autocompleteContainer,
                {backgroundColor: isDarkMode ? '#333' : '#fff'},
              ]}
              inputContainerStyle={styles.inputContainer}
              editable={!isNavigating}
              style={{color: textColor}}
              placeholderTextColor={isDarkMode ? '#ccc' : '#666'}
              flatListProps={{
                keyboardShouldPersistTaps: 'always',
                keyExtractor: item => item.name,
                renderItem: ({item}) => (
                  <TouchableOpacity
                    style={[
                      styles.suggestionItem,
                      {backgroundColor: isDarkMode ? '#444' : '#fff'},
                    ]}
                    onPress={() => {
                      if (isMounted.current) {
                        setQuery(item.name);
                        setDestination(item.coords);
                        setSuggestions([]);
                      }
                    }}>
                    <Text style={[styles.suggestionText, {color: textColor}]}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                ),
              }}
            />
          </View>

          <MapboxGL.MapView
            style={styles.map}
            styleURL={MapboxGL.StyleURL.Street}
            onTouchStart={() => setIsMapInteracting(true)}
            onTouchEnd={() => setIsMapInteracting(false)}
            onTouchCancel={() => setIsMapInteracting(false)}>
            <MapboxGL.Camera
              ref={cameraRef}
              centerCoordinate={currentLocation || [-1224194, 37.7749]}
              zoomLevel={isNavigating ? 17 : 12}
              bearing={currentHeading}
            />
            {currentLocation && (
              <MapboxGL.PointAnnotation
                id="current"
                key={`current-${currentLocation[0]}-${currentLocation[1]}`}
                coordinate={currentLocation}
                anchor={{x: 0.5, y: 0.5}}>
                <Image
                  source={Images.current}
                  style={styles.markerIcon}
                  onError={e =>
                    console.log('Current marker load error:', e.nativeEvent)
                  }
                />
              </MapboxGL.PointAnnotation>
            )}
            {destination && (
              <MapboxGL.PointAnnotation
                id="destination"
                key={`dest-${destination[0]}-${destination[1]}`}
                coordinate={destination}
                anchor={{x: 0.5, y: 0.5}}>
                <Image
                  source={Images.destination}
                  style={styles.markerIcon}
                  onError={e =>
                    console.log('Destination marker load error:', e.nativeEvent)
                  }
                />
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
                    anchor={{x: 0.5, y: 0.5}}>
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
            <View
              style={[
                styles.navigationPanel,
                {
                  backgroundColor: isDarkMode
                    ? 'rgba(51, 51, 51, 0.95)'
                    : 'rgba(255, 255, 255, 0.95)',
                },
              ]}>
              <Text style={[styles.instruction, {color: textColor}]}>
                {steps[currentStepIndex].maneuver.instruction}
              </Text>
              <Text
                style={[
                  styles.stepDistance,
                  {color: isDarkMode ? '#ccc' : '#666'},
                ]}>
                In{' '}
                {steps[currentStepIndex].distance > 1000
                  ? (steps[currentStepIndex].distance / 1000).toFixed(1) + ' km'
                  : Math.round(steps[currentStepIndex].distance) + ' m'}
              </Text>
              <Text style={[styles.infoText, {color: textColor}]}>
                Remaining: {routeInfo.remainingDistance} km, ETA:{' '}
                {routeInfo.remainingDuration}
              </Text>
              {/* <View style={styles.stepControls}>
                <TouchableOpacity
                  style={[
                    styles.stepButton,
                    currentStepIndex === 0 && styles.stepButtonDisabled,
                  ]}
                  onPress={() => handleStepChange(currentStepIndex - 1)}
                  disabled={currentStepIndex === 0}>
                  <Text style={styles.stepButtonText}>◄</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.stepButton,
                    currentStepIndex >= steps.length - 1 &&
                      styles.stepButtonDisabled,
                  ]}
                  onPress={() => handleStepChange(currentStepIndex + 1)}
                  disabled={currentStepIndex >= steps.length - 1}>
                  <Text style={styles.stepButtonText}>►</Text>
                </TouchableOpacity>
              </View> */}
            </View>
          )}

          {!isNavigating && routeInfo.distance && routeInfo.duration && (
            <View
              style={[
                styles.routeInfo,
                {
                  backgroundColor: isDarkMode
                    ? 'rgba(51, 51, 51, 0.95)'
                    : 'rgba(255, 255, 255, 0.95)',
                },
              ]}>
              <Text style={[styles.infoText, {color: textColor}]}>
                Distance: {routeInfo.distance} km
              </Text>
              <Text style={[styles.infoText, {color: textColor}]}>
                ETA: {routeInfo.duration}
              </Text>
            </View>
          )}

          <View style={styles.bottomButtonContainer}>
            {isNavigating ? (
              <TouchableOpacity
                style={styles.stopButton}
                onPress={stopNavigation}>
                <Text style={styles.buttonText}>Stop</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.startButton,
                  !destination && styles.buttonDisabled,
                ]}
                onPress={startNavigation}
                disabled={!destination}>
                <Text style={styles.buttonText}>Start</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1},
  loading: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  searchContainer: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    zIndex: 10,
  },
  autocompleteContainer: {
    borderRadius: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  inputContainer: {borderWidth: 0, padding: 10},
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  suggestionText: {fontSize: 16},
  map: {flex: 1},
  markerIcon: {width: 32, height: 32, resizeMode: 'contain'},
  stepMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepMarkerText: {color: '#fff', fontSize: 14, fontWeight: 'bold'},
  navigationPanel: {
    position: 'absolute',
    top: 80,
    left: 20,
    right: 20,
    padding: 15,
    borderRadius: 8,
    elevation: 4,
  },
  instruction: {fontSize: 18, fontWeight: '600', marginBottom: 5},
  stepDistance: {fontSize: 14, marginBottom: 5},
  infoText: {fontSize: 16, fontWeight: '500', marginVertical: 2},
  stepControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingHorizontal: 20,
  },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.9,
  },
  stepButtonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  stepButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  routeInfo: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    padding: 15,
    borderRadius: 8,
    elevation: 4,
    alignItems: 'center',
  },
  bottomButtonContainer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  startButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 25,
    width: '60%',
    alignItems: 'center',
  },
  stopButton: {
    backgroundColor: '#FF3B30',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 25,
    width: '60%',
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
});

export default NavigationApp;
