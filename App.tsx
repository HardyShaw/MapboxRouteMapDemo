/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React from 'react';
import {SafeAreaView, StyleSheet, View} from 'react-native';
import Mapbox from '@rnmapbox/maps';
import MapScreen from './src/screen/MapScreen';

Mapbox.setAccessToken('PUBLIC ACCESS TOKEN');

function App(): React.JSX.Element {
  return (
    <SafeAreaView style={{flex: 1}}>
      <View style={styles.page}>
        <View style={styles.container}>
          {/* <Mapbox.MapView style={styles.map} /> */}
          <MapScreen />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    height: '100%',
    width: '100%',
  },
  map: {
    flex: 1,
  },
});

export default App;
