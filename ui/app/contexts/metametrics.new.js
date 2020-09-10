/**
 * This file is intended to be renamed to metametrics.js once the conversion is complete.
 * MetaMetrics is our own brand, and should remain aptly named regardless of the underlying
 * metrics system. This file implements Segment analytics tracking.
 */
import React, { Component, createContext, useEffect, useCallback } from 'react'
import { useSelector } from 'react-redux'
import PropTypes from 'prop-types'
import { useLocation, matchPath } from 'react-router-dom'
import { captureException, captureMessage } from '@sentry/browser'

import { omit } from 'lodash'
import {
  getCurrentNetworkId,
} from '../selectors/selectors'

import { getEnvironmentType, getPlatform } from '../../../app/scripts/lib/util'
import {
  sendCountIsTrackable,
  segment,
  METAMETRICS_ANONYMOUS_ID,
} from '../helpers/utils/metametrics.util'
import { PATH_NAME_MAP } from '../helpers/constants/routes'

export const MetaMetricsContext = createContext(() => {
  captureException(
    Error(`MetaMetrics context function was called from a react node that is not a descendant of a MetaMetrics context provider`),
  )
})

const PATHS_TO_CHECK = Object.keys(PATH_NAME_MAP)

export function MetaMetricsProvider ({ children }) {
  const network = useSelector(getCurrentNetworkId)
  const metaMetricsId = useSelector((state) => state.metamask.metaMetricsId)
  const participateInMetaMetrics = useSelector((state) => state.metamask.participateInMetaMetrics)
  const metaMetricsSendCount = useSelector((state) => state.metamask.metaMetricsSendCount)
  const location = useLocation()

  /**
   * Anytime the location changes, track a page change with segment.
   * Previously we would manually track changes to history and keep a
   * reference to the previous url, but with page tracking we can see
   * which page the user is on and their navigation path.
   */
  useEffect(() => {
    if (location.pathname.startsWith('/initialize') || participateInMetaMetrics) {
      // Events that happen during initialization before the user opts into MetaMetrics will be anonymous
      const idTrait = metaMetricsId ? 'userId' : 'anonymousId'
      const idValue = metaMetricsId ?? METAMETRICS_ANONYMOUS_ID
      const match = matchPath(location.pathname, { path: PATHS_TO_CHECK, exact: true, strict: true })
      if (match) {
        const { path, params } = match
        const name = PATH_NAME_MAP[path]
        segment.page({
          [idTrait]: idValue,
          name,
          properties: {
            url: path,
            hash: location.hash,
            // We do not want to send addresses or accounts in any events
            // Some routes include these as params.
            params: omit(params, ['account', 'address']),
          },
        })
      } else if (location.pathname !== '/confirm-transaction') {
        // We have more specific pages for each type of transaction confirmation
        // The user lands on /confirm-transaction first, then is redirected based on
        // the contents of state.
        captureMessage(`${location.pathname} would have issued a page track event to segment, but no route match was found`)
      }
    }
  }, [location, metaMetricsId, participateInMetaMetrics])

  /**
   * track a metametrics event using segment
   * e.g metricsEvent({ event: 'Unlocked MetaMask', category: 'Navigation' })
   *
   * @param {object}  config - configuration object for the event to track
   * @param {string}  config.event - event name to track
   * @param {string}  config.category - category to associate event to
   * @param {boolean} [config.isOptIn] - happened during opt in/out workflow
   * @param {object}  [config.properties] - object of custom values to track, snake_case
   * @param {number}  [config.revenue] - amount of currency that event creates in revenue for MetaMask
   * @param {string}  [config.currency] - ISO 4127 format currency for events with revenue, defaults to US dollars
   * @param {number}  [config.value] - Abstract "value" that this event has for MetaMask.
   * @return {undefined}
   */
  const trackEvent = useCallback(
    (config = {}) => {
      const { event, category, isOptIn = false, properties = {} } = config
      if (!event) {
        // Event name is required for tracking an event
        throw new Error('MetaMetrics trackEvent function must be provided a payload with an "event" key')
      }
      if (!category) {
        // Category must be supplied for every tracking event
        throw new Error('MetaMetrics events must be provided a category')
      }

      let excludeMetaMetricsId = config.excludeMetaMetricsId ?? false

      // This is carried over from the old implementation, and will likely need
      // to be updated to work with the new tracking plan. I think we should use
      // a config setting for this instead of trying to match the event name
      const isSendFlow = Boolean(event.match(/^send|^confirm/u))
      if (isSendFlow && !sendCountIsTrackable(metaMetricsSendCount + 1)) {
        excludeMetaMetricsId = true
      }
      const idTrait = excludeMetaMetricsId ? 'anonymousId' : 'userId'
      const idValue = excludeMetaMetricsId ? METAMETRICS_ANONYMOUS_ID : metaMetricsId

      if (participateInMetaMetrics || isOptIn) {
        segment.track({
          [idTrait]: idValue,
          event,
          properties: {
            ...omit(properties, ['revenue', 'currency', 'value']),
            category,
            exclude_meta_metrics_id: excludeMetaMetricsId,
          },
          context: {
            version: global.platform.getVersion(),
            environment: process.env.METAMASK_ENVIRONMENT,
            platform: getPlatform(),
            network,
            environment_type: getEnvironmentType(),
          },
        })
      }

      return undefined
    }, [
      network,
      metaMetricsId,
      metaMetricsSendCount,
      participateInMetaMetrics,
    ],
  )

  return (
    <MetaMetricsContext.Provider value={trackEvent}>
      {children}
    </MetaMetricsContext.Provider>
  )
}

MetaMetricsProvider.propTypes = { children: PropTypes.node }

export class LegacyMetaMetricsProvider extends Component {
  static propTypes = {
    children: PropTypes.node,
  }

  static defaultProps = {
    children: undefined,
  }

  static contextType = MetaMetricsContext

  static childContextTypes = {
    // I think this has to be different than the old one so that there isn't confusion
    trackEvent: PropTypes.func,
  }

  getChildContext () {
    return {
      // I think this has to be different than the old one so that there isn't confusion
      trackEvent: this.context,
    }
  }

  render () {
    return this.props.children
  }
}
