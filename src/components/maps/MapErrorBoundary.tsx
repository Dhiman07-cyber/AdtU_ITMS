"use client";

import React,{ Component,ReactNode } from "react";
import MapFallbackUI from "./MapFallbackUI";

interface MapErrorBoundaryProps {
    children: ReactNode;
    onRetry?: () => void;
}

interface MapErrorBoundaryState {
    hasError: boolean;
    errorId: string | null;
}

/**
 * Error boundary for map components.
 * Catches render errors and shows a user-friendly fallback
 * instead of raw error messages.
 */
export default class MapErrorBoundary extends Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
    constructor(props: MapErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, errorId: null };
    }

    static getDerivedStateFromError(_error: Error): MapErrorBoundaryState {
        const errorId = `map_err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return { hasError: true, errorId };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        // Log privately — never expose to user
        console.error(`[MapErrorBoundary][${this.state.errorId}] Map render error:`, {
            message: error.message,
            stack: error.stack?.split("\n").slice(0, 5).join("\n"),
            componentStack: errorInfo.componentStack?.split("\n").slice(0, 5).join("\n"),
        });
    }

    handleRetry = () => {
        this.setState({ hasError: false, errorId: null });
        this.props.onRetry?.();
    };

    render() {
        if (this.state.hasError) {
            return <MapFallbackUI onRetry={this.handleRetry} />;
        }
        return this.props.children;
    }
}
