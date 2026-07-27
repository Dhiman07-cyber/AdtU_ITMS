"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft,ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";

interface PermissionDeniedCardProps {
    title?: string;
    description?: string;
    actionName?: string;
    showGoBack?: boolean;
    onClose?: () => void;
}

export function PermissionDeniedCard({
    title = "Operation Not Allowed",
    description,
    actionName,
    showGoBack = true,
    onClose,
}: PermissionDeniedCardProps) {
    const router = useRouter();

    const formattedDescription =
        description ||
        (actionName
            ? `This moderator is not allowed to perform the operation "${actionName}".`
            : "This moderator is not allowed to perform this operation.");

    return (
        <div className="flex items-center justify-center p-4 min-h-[350px] w-full">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-md p-6 max-w-md w-full text-left space-y-5 transition-all duration-200">
                <div className="flex items-start gap-4">
                    <div className="p-3 bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 rounded-xl flex-shrink-0">
                        <ShieldAlert className="w-6 h-6" />
                    </div>
                    <div className="space-y-1.5 flex-1">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 leading-snug">
                            {title}
                        </h3>
                        <p className="text-sm font-normal not-italic text-gray-600 dark:text-gray-400 leading-relaxed">
                            {formattedDescription}
                        </p>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                    {onClose && (
                        <Button
                            type="button"
                            className="bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-100 dark:border-gray-600 font-medium px-4 py-2 text-sm rounded-lg"
                            onClick={onClose}
                        >
                            Close
                        </Button>
                    )}
                    {showGoBack && (
                        <Button
                            type="button"
                            className="bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-100 dark:border-gray-600 font-medium px-4 py-2 text-sm rounded-lg inline-flex items-center gap-2"
                            onClick={() => router.back()}
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Go Back
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
