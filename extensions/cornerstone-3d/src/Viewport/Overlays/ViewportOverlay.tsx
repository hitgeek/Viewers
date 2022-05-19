import React, { useCallback, useEffect, useState } from 'react';
import { vec2, vec3 } from 'gl-matrix';
import PropTypes from 'prop-types';
import { metaData, Enums, utilities } from '@cornerstonejs/core';
import { ViewportOverlay } from '@ohif/ui';

import Cornerstone3DViewportService from '../../services/ViewportService/Cornerstone3DViewportService';

const EPSILON = 1e-4;

function CornerstoneViewportOverlay({
  element,
  viewportData,
  imageSliceData,
  viewportIndex,
  ToolBarService,
}) {
  const [voi, setVOI] = useState({ windowCenter: null, windowWidth: null });
  const [scale, setScale] = useState(1);
  const [activeTools, setActiveTools] = useState([]);

  /**
   * Initial toolbar state
   */
  useEffect(() => {
    setActiveTools(ToolBarService.getActiveTools());
  }, []);

  /**
   * Updating the VOI when the viewport changes its voi
   */
  useEffect(() => {
    const updateVOI = eventDetail => {
      const { range } = eventDetail.detail;

      if (!range) {
        return;
      }

      const { lower, upper } = range;
      const { windowWidth, windowCenter } = utilities.windowLevel.toWindowLevel(
        lower,
        upper
      );

      setVOI({ windowCenter, windowWidth });
    };

    element.addEventListener(Enums.Events.VOI_MODIFIED, updateVOI);

    return () => {
      element.removeEventListener(Enums.Events.VOI_MODIFIED, updateVOI);
    };
  }, [viewportIndex, viewportData]);

  /**
   * Updating the scale when the viewport changes its zoom
   */
  useEffect(() => {
    const updateScale = eventDetail => {
      const { previousCamera, camera } = eventDetail.detail;

      if (previousCamera.parallelScale !== camera.parallelScale) {
        const viewport = Cornerstone3DViewportService.getCornerstone3DViewportByIndex(
          viewportIndex
        );

        if (!viewport) {
          return;
        }

        const imageData = viewport.getImageData();

        if (!imageData) {
          return;
        }

        const { dimensions, spacing } = imageData;

        // Todo: handle for the volume viewports with directions
        const scale = (dimensions[0] * spacing[0]) / camera.parallelScale;
        setScale(scale);
      }
    };

    element.addEventListener(Enums.Events.CAMERA_MODIFIED, updateScale);

    return () => {
      element.removeEventListener(Enums.Events.CAMERA_MODIFIED, updateScale);
    };
  }, [viewportIndex, viewportData]);

  /**
   * Updating the active tools when the toolbar changes
   */
  // Todo: this should act on the toolGroups instead of the toolbar state
  useEffect(() => {
    const { unsubscribe } = ToolBarService.subscribe(
      ToolBarService.EVENTS.TOOL_BAR_STATE_MODIFIED,
      () => {
        setActiveTools(ToolBarService.getActiveTools());
      }
    );

    return () => {
      unsubscribe();
    };
  }, [ToolBarService]);

  const getTopLeftContent = useCallback(() => {
    const { windowWidth, windowCenter } = voi;

    if (activeTools.includes('WindowLevel')) {
      if (typeof windowCenter !== 'number' || typeof windowWidth !== 'number') {
        return null;
      }

      return (
        <div className="flex flex-row">
          <span className="mr-1">W:</span>
          <span className="ml-1 mr-2 font-light">{windowWidth.toFixed(0)}</span>
          <span className="mr-1">L:</span>
          <span className="ml-1 font-light">{windowCenter.toFixed(0)}</span>
        </div>
      );
    }

    if (activeTools.includes('Zoom')) {
      return (
        <div className="flex flex-row">
          <span className="mr-1">Zoom:</span>
          <span className="font-light">{scale.toFixed(2)}x</span>
        </div>
      );
    }

    return null;
  }, [voi, scale, activeTools]);

  const getTopRightContent = useCallback(() => {
    let { imageIndex, numberOfSlices } = imageSliceData;
    if (!viewportData) {
      return;
    }

    let instanceNumber;

    if (viewportData.viewportType === Enums.ViewportType.STACK) {
      const instanceNumber = _getInstanceNumberFromStack(
        viewportData,
        imageIndex
      );

      if (!instanceNumber) {
        return null;
      }

      imageIndex = imageIndex + 1;
    } else if (viewportData.viewportType === Enums.ViewportType.ORTHOGRAPHIC) {
      instanceNumber = _getInstanceNumberFromVolume(
        viewportData,
        imageIndex,
        viewportIndex
      );
    }

    return (
      <div className="flex flex-row">
        <span className="mr-1">I:</span>
        <span className="font-light">
          {instanceNumber !== undefined
            ? `${instanceNumber} (${imageIndex}/${numberOfSlices})`
            : `${imageIndex}/${numberOfSlices}`}
        </span>
      </div>
    );
  }, [imageSliceData, viewportData, viewportIndex]);

  if (!viewportData) {
    return null;
  }

  if (viewportData.imageIds.length === 0) {
    throw new Error(
      'ViewportOverlay: only viewports with imageIds is supported at this time'
    );
  }

  return (
    <ViewportOverlay
      topLeft={getTopLeftContent()}
      topRight={getTopRightContent()}
    />
  );
}

function _getInstanceNumberFromStack(viewportData, imageIndex) {
  const imageIds = viewportData.imageIds;
  const imageId = imageIds[imageIndex];

  if (!imageId) {
    return;
  }

  const generalImageModule = metaData.get('generalImageModule', imageId) || {};
  const { instanceNumber } = generalImageModule;

  const stackSize = imageIds.length;

  if (stackSize <= 1) {
    return;
  }

  return parseInt(instanceNumber);
}

function _getInstanceNumberFromVolume(viewportData, imageIndex, viewportIndex) {
  const volumes = viewportData.volumes;

  // Todo: support fusion of acquisition plane which has instanceNumber
  if (!volumes || volumes.length > 1) {
    return;
  }

  const volume = volumes[0];
  const { direction, imageIds } = volume;

  const cornerstoneViewport = Cornerstone3DViewportService.getCornerstone3DViewportByIndex(
    viewportIndex
  );

  if (!cornerstoneViewport) {
    return;
  }

  const camera = cornerstoneViewport.getCamera();
  const { viewPlaneNormal } = camera;
  // checking if camera is looking at the acquisition plane (defined by the direction on the volume)

  const scanAxisNormal = direction.slice(6, 9);

  // check if viewPlaneNormal is parallel to scanAxisNormal
  const cross = vec3.cross(vec3.create(), viewPlaneNormal, scanAxisNormal);
  const isAcquisitionPlane = vec3.length(cross) < EPSILON;

  if (isAcquisitionPlane) {
    const { instanceNumber } =
      metaData.get('generalImageModule', imageIds[imageIndex]) || {};
    return parseInt(instanceNumber);
  }
}

CornerstoneViewportOverlay.propTypes = {
  viewportData: PropTypes.object,
  imageIndex: PropTypes.number,
  viewportIndex: PropTypes.number,
};

export default CornerstoneViewportOverlay;
