import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { EnactLogo } from "@/components/brand/enact-logo";
import { useAuthStore } from "@/data/auth-store";
import { mapAuthError } from "@/lib/auth-error";

export default function Login() {
  const loginWithEmail = useAuthStore((s) => s.loginWithEmail);
  const registerWithEmail = useAuthStore((s) => s.registerWithEmail);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed || !password || (mode === "register" && !name.trim())) return;
    if (
      mode === "register" &&
      !trimmed.toLowerCase().endsWith("@deloittecn.com.cn")
    ) {
      setError("Only @deloittecn.com.cn email addresses can register.");
      return;
    }
    if (mode === "register" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    void Haptics.selectionAsync();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "register") {
        await registerWithEmail(trimmed, password, name.trim());
      } else {
        await loginWithEmail(trimmed, password);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(mapAuthError(err, "Couldn't sign in. Try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 justify-center px-6 gap-6">
          <View className="items-center gap-3">
            <EnactLogo size={32} />
            <View className="gap-1 items-center">
              <Text className="text-2xl font-semibold text-foreground">
                {mode === "register"
                  ? "Create your account"
                  : "Sign in to Enact"}
              </Text>
              <Text className="text-sm text-muted-foreground text-center">
                {mode === "register"
                  ? "Register with your Deloitte China email."
                  : "Enter your email and password."}
              </Text>
            </View>
          </View>

          <View className="gap-3">
            {mode === "register" ? (
              <TextField
                autoCapitalize="words"
                autoComplete="name"
                autoFocus
                placeholder="Username shown to teammates"
                value={name}
                onChangeText={setName}
                editable={!submitting}
                invalid={!!error}
              />
            ) : null}
            <TextField
              autoCapitalize="none"
              autoComplete="email"
              autoFocus={mode === "login"}
              keyboardType="email-address"
              placeholder={
                mode === "register"
                  ? "name@deloittecn.com.cn"
                  : "you@example.com"
              }
              value={email}
              onChangeText={setEmail}
              returnKeyType="next"
              editable={!submitting}
              invalid={!!error}
            />
            <TextField
              autoCapitalize="none"
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={onSubmit}
              returnKeyType="go"
              secureTextEntry
              editable={!submitting}
              invalid={!!error}
            />
            {mode === "register" ? (
              <Text className="text-sm text-muted-foreground">
                Use at least 8 characters.
              </Text>
            ) : null}
            {error ? (
              <Text className="text-sm text-destructive">{error}</Text>
            ) : null}
          </View>

          <Button
            size="lg"
            disabled={
              submitting ||
              !email.trim() ||
              !password ||
              (mode === "register" && !name.trim())
            }
            onPress={onSubmit}
          >
            <Text>
              {submitting
                ? mode === "register"
                  ? "Creating account..."
                  : "Signing in..."
                : mode === "register"
                  ? "Create account"
                  : "Sign in"}
            </Text>
          </Button>
          <Button
            variant="ghost"
            disabled={submitting}
            onPress={() => {
              setMode((current) =>
                current === "login" ? "register" : "login",
              );
              setPassword("");
              setError(null);
            }}
          >
            <Text>
              {mode === "register"
                ? "Already have an account? Sign in"
                : "Create an account"}
            </Text>
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
