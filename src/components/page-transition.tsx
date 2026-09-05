"use client";

import { motion } from "motion/react";

export const PageTransition = ({ children }: { children: React.ReactNode }) => {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.98, translateY: 10 }}
            animate={{ opacity: 1, scale: 1, translateY: 0 }}
            exit={{ opacity: 0, scale: 0.98, translateY: -10 }}
            transition={{
                duration: 0.3,
                ease: [0.22, 1, 0.36, 1]
            }}
            className="w-full h-full"
        >
            {children}
        </motion.div>
    );
};
