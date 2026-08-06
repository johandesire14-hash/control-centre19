import LottieView from "lottie-react-native";
import React, { useRef } from "react";
import { StyleSheet, View } from "react-native";

import splashAnimation from "@/assets/animations/splash.json";

export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  const animationRef = useRef<LottieView>(null);

  return (
    <View style={styles.container}>
      <LottieView
        ref={animationRef}
        source={splashAnimation}
        autoPlay
        loop={false}
        resizeMode="cover"
        style={styles.animation}
        onAnimationFinish={onFinish}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    backgroundColor: "#0D0D0A",
    alignItems: "center",
    justifyContent: "center",
  },
  animation: {
    width: "100%",
    height: "100%",
  },
});
