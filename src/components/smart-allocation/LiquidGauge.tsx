'use client';

import * as d3 from 'd3';
import { useEffect,useRef } from 'react';

interface LiquidGaugeProps {
  value: number;
  size?: number;
  color?: string;
  waveHeight?: number;
  waveCount?: number;
  waveSpeed?: number;
}

export default function LiquidGauge({
  value,
  size = 100,
  color = '#f59e0b',
  waveHeight = 0.1,
  waveCount = 2,
  waveSpeed = 1
}: LiquidGaugeProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const waveRef = useRef<any>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const radius = size / 2;
    const fillPercent = Math.max(0, Math.min(100, value)) / 100;
    const waveHeightScale = d3.scaleLinear()
      .domain([0, 100])
      .range([waveHeight, waveHeight * 0.5]);

    // Container
    const g = svg.append("g")
      .attr("transform", `translate(${radius},${radius})`);

    // Background circle
    g.append("circle")
      .attr("r", radius - 2)
      .style("fill", "rgba(255, 255, 255, 0.05)")
      .style("stroke", color)
      .style("stroke-width", "2px")
      .style("stroke-opacity", 0.3);

    // Clipping path
    const clipPath = g.append("defs")
      .append("clipPath")
      .attr("id", `clip-${Date.now()}`);

    clipPath.append("circle")
      .attr("r", radius - 2);

    // Wave
    const waveGroup = g.append("g")
      .attr("clip-path", `url(#clip-${Date.now()})`);

    const data: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 40 * waveCount; i++) {
      data.push({ x: i / (40 * waveCount), y: 0.5 });
    }

    const waveScaleX = d3.scaleLinear().domain([0, 1]).range([0, 2 * Math.PI * waveCount]);
    const waveScaleY = d3.scaleLinear().domain([0, 1]).range([0, radius * 2]);

    const line = d3.area<{ x: number; y: number }>()
      .x((d) => waveScaleY(d.x))
      .y0(() => waveScaleY(1))
      .y1((d) => waveScaleY(d.y))
      .curve(d3.curveNatural);

    const calculatedWaveHeight = waveHeightScale(value * 100);
    const waveOffset = radius * 2 * (1 - fillPercent);

    const wave = waveGroup.append("path")
      .datum(data)
      .attr("d", line)
      .attr("transform", `translate(-${radius * 2}, ${waveOffset})`)
      .style("fill", color)
      .style("opacity", 0.7);

    // Animate wave
    const animateWave = () => {
      waveRef.current = d3.timer((elapsed: number) => {
        const waveAnimate = elapsed * waveSpeed / 20000;
        const newData = data.map(d => ({
          x: d.x,
          y: 0.5 + calculatedWaveHeight * Math.sin(waveScaleX(d.x) + waveAnimate)
        }));
        wave.datum(newData).attr("d", line);
      });
    };

    animateWave();

    // Text
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .style("fill", "white")
      .style("font-size", `${size / 4}px`)
      .style("font-weight", "bold")
      .text(`${Math.round(value)}%`);

    return () => {
      if (waveRef.current) {
        waveRef.current.stop();
      }
    };
  }, [value, size, color, waveHeight, waveCount, waveSpeed]);

  return (
    <svg 
      ref={svgRef} 
      width={size} 
      height={size}
      style={{ display: 'block', margin: '0 auto' }}
    />
  );
}
