"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ChevronDown,
  Headphones,
  Loader2,
  Mic,
  MicOff,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
} from "lucide-react";
import { setCallAvailability } from "./actions";

type SoftphoneStatus = "off" | "ready" | "incoming" | "in-call";
type TwilioDevice = InstanceType<(typeof import("@twilio/voice-sdk"))["Device"]>;
type TwilioCall = Awaited<ReturnType<TwilioDevice["connect"]>>;

interface IncomingCall {
  from: string;
  leadName?: string;
}

interface SoftphoneContextValue {
  status: SoftphoneStatus;
  startCall(contactId: string, phoneLabel: string): Promise<void>;
  hangup(): void;
  mute(): void;
  unmute(): void;
  isMuted: boolean;
  incoming: IncomingCall | null;
  accept(): void;
  reject(): void;
  error: string | null;
}

interface Props {
  available: boolean;
  isCrmStaff: boolean;
  children: React.ReactNode;
}

interface TokenResponse {
  token: string;
  identity: string;
}

interface WidgetPosition {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  captureTarget: HTMLElement;
  pointerStartX: number;
  pointerStartY: number;
  widgetStartX: number;
  widgetStartY: number;
  requiresMovementThreshold: boolean;
  exceededClickThreshold: boolean;
}

const SDK_TIMEOUT_MS = 15_000;
const TOKEN_TIMEOUT_MS = 10_000;
const ACTION_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 30_000;
const DRAG_CLICK_THRESHOLD_PX = 5;
const POSITION_STORAGE_KEY = "softphone:position";
const COLLAPSED_STORAGE_KEY = "softphone:collapsed";

const SoftphoneContext = createContext<SoftphoneContextValue | undefined>(undefined);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function fetchVoiceToken(): Promise<TokenResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);

  try {
    const response = await fetch("/api/twilio/voice-token", {
      method: "POST",
      signal: controller.signal,
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch (error: unknown) {
      throw new Error(
        `Voice token endpoint returned malformed JSON: ${errorMessage(error)}`,
      );
    }

    if (!response.ok) {
      const serverError = isRecord(body) && typeof body.error === "string" ? body.error : null;
      throw new Error(serverError ?? `Voice token request failed with HTTP ${response.status}.`);
    }

    if (
      !isRecord(body) ||
      typeof body.token !== "string" ||
      body.token.length === 0 ||
      typeof body.identity !== "string" ||
      body.identity.length === 0
    ) {
      throw new Error("Voice token endpoint returned an invalid response shape.");
    }

    return { token: body.token, identity: body.identity };
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Voice token request timed out after ${TOKEN_TIMEOUT_MS / 1000} seconds.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function clampToViewport(position: WidgetPosition, widget: HTMLElement): WidgetPosition {
  const bounds = widget.getBoundingClientRect();
  const maximumX = Math.max(0, window.innerWidth - bounds.width);
  const maximumY = Math.max(0, window.innerHeight - bounds.height);

  return {
    x: Math.min(Math.max(0, position.x), maximumX),
    y: Math.min(Math.max(0, position.y), maximumY),
  };
}

function restorePersistedPosition(): WidgetPosition | null {
  try {
    const storedValue = window.localStorage.getItem(POSITION_STORAGE_KEY);
    if (storedValue === null) {
      return null;
    }

    const parsedValue: unknown = JSON.parse(storedValue);
    if (
      !isRecord(parsedValue) ||
      typeof parsedValue.x !== "number" ||
      !Number.isFinite(parsedValue.x) ||
      typeof parsedValue.y !== "number" ||
      !Number.isFinite(parsedValue.y)
    ) {
      return null;
    }

    return { x: parsedValue.x, y: parsedValue.y };
  } catch {
    // Storage is a non-essential convenience and may be unavailable or contain malformed JSON.
    return null;
  }
}

function restorePersistedCollapsedState(): boolean {
  try {
    const storedValue = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (storedValue === null) {
      return false;
    }

    const parsedValue: unknown = JSON.parse(storedValue);
    return typeof parsedValue === "boolean" ? parsedValue : false;
  } catch {
    // Storage is a non-essential convenience and may be unavailable or contain malformed JSON.
    return false;
  }
}

function persistPosition(position: WidgetPosition): void {
  try {
    window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Storage is a non-essential convenience, so disabled storage and quota failures are ignored.
  }
}

function persistCollapsedState(isCollapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(isCollapsed));
  } catch {
    // Storage is a non-essential convenience, so disabled storage and quota failures are ignored.
  }
}

export function SoftphoneProvider({ available, isCrmStaff, children }: Props) {
  const [status, setStatus] = useState<SoftphoneStatus>("off");
  const [isAvailable, setIsAvailable] = useState(available);
  const [isAvailabilityPending, setIsAvailabilityPending] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [callLabel, setCallLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRestoredWidgetState, setHasRestoredWidgetState] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [widgetPosition, setWidgetPosition] = useState<WidgetPosition | null>(null);

  const deviceRef = useRef<TwilioDevice | null>(null);
  const activeCallRef = useRef<TwilioCall | null>(null);
  const initializationRef = useRef<Promise<TwilioDevice> | null>(null);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const lifecycleRef = useRef(0);
  const availableRef = useRef(available);
  const staffRef = useRef(isCrmStaff);
  const widgetRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const collapsedClickResetRef = useRef<number | null>(null);
  const suppressCollapsedClickRef = useRef(false);
  const previousStatusRef = useRef<SoftphoneStatus>(status);

  const captureWidgetElement = useCallback((element: HTMLElement | null) => {
    widgetRef.current = element;
  }, []);

  const updateWidgetPosition = useCallback((position: WidgetPosition) => {
    const widget = widgetRef.current;
    if (!widget) {
      return;
    }

    setWidgetPosition(clampToViewport(position, widget));
  }, []);

  const reclampWidgetPosition = useCallback(() => {
    const widget = widgetRef.current;
    if (!widget) {
      return;
    }

    setWidgetPosition((currentPosition) => {
      if (currentPosition === null) {
        return null;
      }

      const clampedPosition = clampToViewport(currentPosition, widget);
      if (
        clampedPosition.x === currentPosition.x &&
        clampedPosition.y === currentPosition.y
      ) {
        return currentPosition;
      }

      return clampedPosition;
    });
  }, []);

  const beginDrag = useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      requiresMovementThreshold: boolean,
    ) => {
      if (dragStateRef.current) {
        return;
      }

      const widget = widgetRef.current;
      if (!widget) {
        return;
      }

      const bounds = widget.getBoundingClientRect();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety; the drag still works from the element's own pointer events.
      }
      dragStateRef.current = {
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
        widgetStartX: bounds.left,
        widgetStartY: bounds.top,
        requiresMovementThreshold,
        exceededClickThreshold: false,
      };
    },
    [],
  );

  const beginExpandedDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest("button, a, input")) {
        return;
      }

      beginDrag(event, false);
    },
    [beginDrag],
  );

  const beginCollapsedDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      beginDrag(event, true);
    },
    [beginDrag],
  );

  const moveWidget = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      const movementX = event.clientX - dragState.pointerStartX;
      const movementY = event.clientY - dragState.pointerStartY;
      if (Math.hypot(movementX, movementY) > DRAG_CLICK_THRESHOLD_PX) {
        dragState.exceededClickThreshold = true;
      }

      if (dragState.requiresMovementThreshold && !dragState.exceededClickThreshold) {
        return;
      }

      updateWidgetPosition({
        x: dragState.widgetStartX + movementX,
        y: dragState.widgetStartY + movementY,
      });
    },
    [updateWidgetPosition],
  );

  const releaseDrag = useCallback((event: React.PointerEvent<HTMLElement>): DragState | null => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return null;
    }

    if (dragState.captureTarget.hasPointerCapture(event.pointerId)) {
      dragState.captureTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    return dragState;
  }, []);

  const resetCollapsedClickSuppression = useCallback(() => {
    if (collapsedClickResetRef.current !== null) {
      window.clearTimeout(collapsedClickResetRef.current);
    }
    collapsedClickResetRef.current = window.setTimeout(() => {
      suppressCollapsedClickRef.current = false;
      collapsedClickResetRef.current = null;
    }, 0);
  }, []);

  const finishExpandedDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      releaseDrag(event);
    },
    [releaseDrag],
  );

  const finishCollapsedDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const dragState = releaseDrag(event);
      if (!dragState) {
        return;
      }

      if (dragState.exceededClickThreshold) {
        suppressCollapsedClickRef.current = true;
        resetCollapsedClickSuppression();
        return;
      }

      setIsCollapsed(false);
    },
    [releaseDrag, resetCollapsedClickSuppression],
  );

  const cancelDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    releaseDrag(event);
  }, [releaseDrag]);

  const clearDroppedDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
    }
  }, []);

  const expandCollapsedWidget = useCallback(() => {
    if (suppressCollapsedClickRef.current) {
      suppressCollapsedClickRef.current = false;
      return;
    }

    setIsCollapsed(false);
  }, []);

  const clearElapsedTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startElapsedTimer = useCallback(() => {
    clearElapsedTimer();
    setElapsedSeconds(0);
    timerRef.current = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1);
    }, 1000);
  }, [clearElapsedTimer]);

  const finishCall = useCallback(
    (call: TwilioCall) => {
      call.removeAllListeners();
      if (activeCallRef.current !== call) {
        return;
      }

      activeCallRef.current = null;
      clearElapsedTimer();
      setElapsedSeconds(0);
      setIncoming(null);
      setCallLabel(null);
      setIsMuted(false);
      setStatus(availableRef.current && deviceRef.current ? "ready" : "off");

      if (!availableRef.current && deviceRef.current) {
        deviceRef.current.removeAllListeners();
        deviceRef.current.destroy();
        deviceRef.current = null;
      }
    },
    [clearElapsedTimer],
  );

  const attachCallListeners = useCallback(
    (call: TwilioCall) => {
      const onEnded = () => finishCall(call);
      const onAccepted = () => {
        if (activeCallRef.current !== call) {
          return;
        }
        setIncoming(null);
        setStatus("in-call");
        startElapsedTimer();
      };
      const onCallError = (callError: unknown) => {
        setError(`Call error: ${errorMessage(callError)}`);
        finishCall(call);
      };
      const onMuteChanged = (muted: boolean) => setIsMuted(muted);

      call.on("accept", onAccepted);
      call.on("disconnect", onEnded);
      call.on("cancel", onEnded);
      call.on("reject", onEnded);
      call.on("error", onCallError);
      call.on("mute", onMuteChanged);
    },
    [finishCall, startElapsedTimer],
  );

  const destroyDevice = useCallback(() => {
    clearElapsedTimer();

    const call = activeCallRef.current;
    if (call) {
      call.removeAllListeners();
      activeCallRef.current = null;
    }

    const device = deviceRef.current;
    if (device) {
      device.removeAllListeners();
      device.destroy();
      deviceRef.current = null;
    }

    setIncoming(null);
    setCallLabel(null);
    setIsMuted(false);
    setElapsedSeconds(0);
    setStatus("off");
  }, [clearElapsedTimer]);

  const initializeDevice = useCallback(async (): Promise<TwilioDevice> => {
    if (!staffRef.current) {
      throw new Error("Softphone access is restricted to CRM staff.");
    }

    if (deviceRef.current) {
      return deviceRef.current;
    }

    if (initializationRef.current) {
      return initializationRef.current;
    }

    const lifecycle = lifecycleRef.current;
    const initialization = (async () => {
      setIsInitializing(true);
      const sdk = await withTimeout(
        import("@twilio/voice-sdk"),
        SDK_TIMEOUT_MS,
        "Loading the Twilio Voice SDK",
      );
      const { token } = await fetchVoiceToken();

      if (!mountedRef.current || lifecycleRef.current !== lifecycle || !staffRef.current) {
        throw new Error("Softphone initialization was cancelled.");
      }

      const device = new sdk.Device(token);
      deviceRef.current = device;

      const onDeviceError = (deviceError: unknown) => {
        setError(`Softphone device error: ${errorMessage(deviceError)}`);
      };
      const onTokenWillExpire = () => {
        void fetchVoiceToken()
          .then(({ token: refreshedToken }) => {
            if (deviceRef.current === device) {
              device.updateToken(refreshedToken);
            }
          })
          .catch((refreshError: unknown) => {
            if (mountedRef.current) {
              setError(`Could not refresh the voice token: ${errorMessage(refreshError)}`);
            }
          });
      };
      const onIncoming = (call: TwilioCall) => {
        if (activeCallRef.current) {
          try {
            call.reject();
          } catch (rejectError: unknown) {
            setError(`Could not decline the additional incoming call: ${errorMessage(rejectError)}`);
          }
          setError((current) => current ?? "An additional incoming call was declined while busy.");
          return;
        }

        const contactId = call.customParameters.get("contactId");
        const leadName = call.customParameters.get("leadName")?.trim();
        const from = call.parameters.From?.trim() || "Unknown caller";

        setError(contactId ? null : "Incoming call is missing its contact identifier.");
        activeCallRef.current = call;
        attachCallListeners(call);
        setIncoming({ from, ...(leadName ? { leadName } : {}) });
        setCallLabel(leadName || from);
        setStatus("incoming");
      };

      device.on("error", onDeviceError);
      device.on("tokenWillExpire", onTokenWillExpire);
      device.on("incoming", onIncoming);

      try {
        await withTimeout(device.register(), SDK_TIMEOUT_MS, "Registering the softphone");
      } catch (registerError: unknown) {
        device.removeAllListeners();
        device.destroy();
        if (deviceRef.current === device) {
          deviceRef.current = null;
        }
        throw new Error(`Could not register the softphone: ${errorMessage(registerError)}`);
      }

      if (!mountedRef.current || lifecycleRef.current !== lifecycle || !staffRef.current) {
        device.removeAllListeners();
        device.destroy();
        if (deviceRef.current === device) {
          deviceRef.current = null;
        }
        throw new Error("Softphone initialization was cancelled.");
      }

      setStatus("ready");
      return device;
    })();

    initializationRef.current = initialization;
    try {
      return await initialization;
    } finally {
      if (initializationRef.current === initialization) {
        initializationRef.current = null;
      }
      if (mountedRef.current) {
        setIsInitializing(false);
      }
    }
  }, [attachCallListeners]);

  const startCall = useCallback(
    async (contactId: string, phoneLabel: string): Promise<void> => {
      if (!staffRef.current) {
        const message = "Only CRM staff can start softphone calls.";
        setError(message);
        throw new Error(message);
      }
      if (!contactId.trim()) {
        const message = "A contact identifier is required to start a call.";
        setError(message);
        throw new Error(message);
      }
      if (activeCallRef.current) {
        const message = "A call is already active.";
        setError(message);
        throw new Error(message);
      }

      setError(null);
      setCallLabel(phoneLabel.trim() || "Outbound call");

      try {
        const device = await initializeDevice();
        const call = await withTimeout(
          device.connect({ params: { contactId } }),
          CONNECT_TIMEOUT_MS,
          "Starting the call",
        );

        if (!mountedRef.current || !staffRef.current) {
          call.disconnect();
          throw new Error("The outbound call was cancelled because the softphone is unavailable.");
        }

        activeCallRef.current = call;
        attachCallListeners(call);
        setStatus("in-call");
        startElapsedTimer();
      } catch (callError: unknown) {
        setCallLabel(null);
        const message = `Could not start the call: ${errorMessage(callError)}`;
        setError(message);
        throw new Error(message, { cause: callError });
      }
    },
    [attachCallListeners, initializeDevice, startElapsedTimer],
  );

  const hangup = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) {
      setError("There is no active call to hang up.");
      return;
    }

    try {
      call.disconnect();
      finishCall(call);
    } catch (hangupError: unknown) {
      setError(`Could not hang up the call: ${errorMessage(hangupError)}`);
    }
  }, [finishCall]);

  const mute = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) {
      setError("There is no active call to mute.");
      return;
    }

    try {
      call.mute(true);
      setIsMuted(true);
    } catch (muteError: unknown) {
      setError(`Could not mute the call: ${errorMessage(muteError)}`);
    }
  }, []);

  const unmute = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) {
      setError("There is no active call to unmute.");
      return;
    }

    try {
      call.mute(false);
      setIsMuted(false);
    } catch (unmuteError: unknown) {
      setError(`Could not unmute the call: ${errorMessage(unmuteError)}`);
    }
  }, []);

  const accept = useCallback(() => {
    const call = activeCallRef.current;
    if (!call || status !== "incoming") {
      setError("There is no incoming call to accept.");
      return;
    }

    try {
      call.accept();
    } catch (acceptError: unknown) {
      setError(`Could not accept the call: ${errorMessage(acceptError)}`);
    }
  }, [status]);

  const reject = useCallback(() => {
    const call = activeCallRef.current;
    if (!call || status !== "incoming") {
      setError("There is no incoming call to decline.");
      return;
    }

    try {
      call.reject();
      finishCall(call);
    } catch (rejectError: unknown) {
      setError(`Could not decline the call: ${errorMessage(rejectError)}`);
    }
  }, [finishCall, status]);

  const toggleAvailability = useCallback(async () => {
    if (!staffRef.current || isAvailabilityPending) {
      if (!staffRef.current) {
        setError("Only CRM staff can change softphone availability.");
      }
      return;
    }

    const nextAvailable = !availableRef.current;
    setIsAvailabilityPending(true);
    setError(null);

    try {
      const savedValue = await withTimeout(
        setCallAvailability(nextAvailable),
        ACTION_TIMEOUT_MS,
        "Updating call availability",
      );
      availableRef.current = savedValue;
      setIsAvailable(savedValue);

      if (savedValue) {
        await initializeDevice();
      } else if (!activeCallRef.current) {
        destroyDevice();
      } else {
        // The current call stays connected, but the Device is destroyed when that call ends.
        setStatus("in-call");
      }
    } catch (availabilityError: unknown) {
      setError(`Could not update call availability: ${errorMessage(availabilityError)}`);
    } finally {
      if (mountedRef.current) {
        setIsAvailabilityPending(false);
      }
    }
  }, [destroyDevice, initializeDevice, isAvailabilityPending]);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleRef.current += 1;

    return () => {
      mountedRef.current = false;
      lifecycleRef.current += 1;
      initializationRef.current = null;
      clearElapsedTimer();

      const dragState = dragStateRef.current;
      if (dragState?.captureTarget.hasPointerCapture(dragState.pointerId)) {
        dragState.captureTarget.releasePointerCapture(dragState.pointerId);
      }
      dragStateRef.current = null;

      if (collapsedClickResetRef.current !== null) {
        window.clearTimeout(collapsedClickResetRef.current);
        collapsedClickResetRef.current = null;
      }

      const call = activeCallRef.current;
      if (call) {
        call.removeAllListeners();
        activeCallRef.current = null;
      }

      const device = deviceRef.current;
      if (device) {
        device.removeAllListeners();
        device.destroy();
        deviceRef.current = null;
      }
    };
  }, [clearElapsedTimer]);

  useEffect(() => {
    staffRef.current = isCrmStaff;
    availableRef.current = available;
    setIsAvailable(available);

    if (!isCrmStaff) {
      destroyDevice();
      return;
    }

    if (available) {
      void initializeDevice().catch((initializationError: unknown) => {
        if (mountedRef.current) {
          setError(`Could not initialize the softphone: ${errorMessage(initializationError)}`);
        }
      });
    } else if (!activeCallRef.current) {
      destroyDevice();
    } else {
      // A prop update must not interrupt an active call; cleanup happens when the call ends.
      setStatus("in-call");
    }
  }, [available, destroyDevice, initializeDevice, isCrmStaff]);

  useEffect(() => {
    const restoreStateTimeout = window.setTimeout(() => {
      setWidgetPosition(restorePersistedPosition());
      setIsCollapsed(restorePersistedCollapsedState());
      setHasRestoredWidgetState(true);
    }, 0);

    return () => {
      window.clearTimeout(restoreStateTimeout);
    };
  }, []);

  useEffect(() => {
    if (!hasRestoredWidgetState || widgetPosition === null) {
      return;
    }

    persistPosition(widgetPosition);
  }, [hasRestoredWidgetState, widgetPosition]);

  useEffect(() => {
    if (!hasRestoredWidgetState) {
      return;
    }

    persistCollapsedState(isCollapsed);
  }, [hasRestoredWidgetState, isCollapsed]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;

    if (previousStatus !== "incoming" && status === "incoming") {
      setIsCollapsed(false);
    }
  }, [status]);

  useEffect(() => {
    window.addEventListener("resize", reclampWidgetPosition);
    return () => {
      window.removeEventListener("resize", reclampWidgetPosition);
    };
  }, [reclampWidgetPosition]);

  useEffect(() => {
    if (!hasRestoredWidgetState) {
      return;
    }

    reclampWidgetPosition();
  }, [
    error,
    hasRestoredWidgetState,
    incoming,
    isCollapsed,
    reclampWidgetPosition,
    status,
  ]);

  const contextValue = useMemo<SoftphoneContextValue>(
    () => ({
      status,
      startCall,
      hangup,
      mute,
      unmute,
      isMuted,
      incoming,
      accept,
      reject,
      error,
    }),
    [accept, error, hangup, incoming, isMuted, mute, reject, startCall, status, unmute],
  );

  const availabilityBusy = isAvailabilityPending || isInitializing;
  const positionedWidgetStyle =
    hasRestoredWidgetState && widgetPosition
      ? { left: widgetPosition.x, top: widgetPosition.y }
      : undefined;
  const defaultPositionClasses =
    hasRestoredWidgetState && widgetPosition ? "" : "bottom-6 right-6";
  const showCollapsedWidget = hasRestoredWidgetState && isCollapsed;

  return (
    <SoftphoneContext.Provider value={contextValue}>
      {children}
      {isCrmStaff && showCollapsedWidget && (
        <button
          ref={captureWidgetElement}
          type="button"
          onClick={expandCollapsedWidget}
          onPointerDown={beginCollapsedDrag}
          onPointerMove={moveWidget}
          onPointerUp={finishCollapsedDrag}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={clearDroppedDrag}
          aria-label="Expand softphone"
          title="Expand softphone"
          style={positionedWidgetStyle}
          className={`fixed ${defaultPositionClasses} z-50 flex h-12 w-12 touch-none select-none items-center justify-center rounded-full text-white shadow-2xl transition-colors ${
            isAvailable
              ? "bg-emerald-500 hover:bg-emerald-600"
              : "bg-slate-500 hover:bg-slate-600 dark:bg-slate-700 dark:hover:bg-slate-600"
          }`}
        >
          <Headphones className="h-5 w-5" />
          {(status === "incoming" || status === "in-call") && (
            <span className="absolute right-0 top-0 h-3 w-3 animate-pulse rounded-full bg-red-400 ring-2 ring-white dark:ring-slate-900" />
          )}
        </button>
      )}
      {isCrmStaff && !showCollapsedWidget && (
        <div
          ref={captureWidgetElement}
          style={positionedWidgetStyle}
          className={`fixed ${defaultPositionClasses} z-50 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 animate-in slide-in-from-bottom-4`}
        >
          <div
            onPointerDown={beginExpandedDrag}
            onPointerMove={moveWidget}
            onPointerUp={finishExpandedDrag}
            onPointerCancel={cancelDrag}
            onLostPointerCapture={clearDroppedDrag}
            className="flex touch-none select-none items-center justify-between gap-3 px-4 py-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Headphones
                className={`h-4 w-4 flex-shrink-0 ${isAvailable ? "text-emerald-500" : "text-slate-400"}`}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-200">
                  Softphone
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isInitializing
                    ? "Connecting..."
                    : status === "ready"
                      ? "Available for calls"
                      : status === "incoming"
                        ? "Incoming call"
                        : status === "in-call"
                          ? "Call in progress"
                          : "Unavailable"}
                </p>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                aria-label="Collapse softphone"
                title="Collapse softphone"
                className="rounded-full bg-slate-100 p-1.5 text-slate-500 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void toggleAvailability()}
                disabled={availabilityBusy}
                aria-pressed={isAvailable}
                className={`relative h-7 w-12 flex-shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isAvailable ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"
                }`}
                title={isAvailable ? "Stop receiving calls" : "Start receiving calls"}
              >
                {availabilityBusy ? (
                  <Loader2 className="absolute left-4 top-1.5 h-4 w-4 animate-spin text-white" />
                ) : (
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      isAvailable ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 border-t border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {status === "incoming" && incoming && (
            <div className="space-y-3 border-t border-slate-100 px-4 py-4 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-emerald-100 p-2 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                  <PhoneIncoming className="h-5 w-5 animate-pulse" />
                </span>
                <div className="min-w-0">
                  {incoming.leadName && (
                    <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-200">
                      {incoming.leadName}
                    </p>
                  )}
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {incoming.from}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={accept}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-600"
                >
                  <PhoneCall className="h-4 w-4" />
                  Accept
                </button>
                <button
                  type="button"
                  onClick={reject}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-red-600"
                >
                  <PhoneOff className="h-4 w-4" />
                  Decline
                </button>
              </div>
            </div>
          )}

          {status === "in-call" && (
            <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">
                  {callLabel ?? "Active call"}
                </p>
                <p className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {formatElapsed(elapsedSeconds)}
                </p>
              </div>
              <button
                type="button"
                onClick={isMuted ? unmute : mute}
                className="rounded-full bg-slate-100 p-2 text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={hangup}
                className="rounded-full bg-red-500 p-2 text-white transition-colors hover:bg-red-600"
                title="Hang up"
              >
                <PhoneOff className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </SoftphoneContext.Provider>
  );
}

export function useSoftphone(): SoftphoneContextValue {
  const context = useContext(SoftphoneContext);
  if (!context) {
    throw new Error("useSoftphone must be used within a SoftphoneProvider.");
  }
  return context;
}
